import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type YahooImportMedia = {
  media_key?: string;
  type?: "photo";
  url?: string;
  preview_image_url?: string | null;
  video_url?: string | null;
  width?: number | null;
  height?: number | null;
};

type YahooImportPost = {
  text?: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  url?: string;
  media?: YahooImportMedia[];
};

type ExistingPost = {
  id: string;
  x_post_id: string;
  author_handle: string | null;
  text: string | null;
  source_url: string | null;
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-import-secret",
  };
}

function normalizeHandle(value?: string) {
  if (!value) return "@unknown";
  const cleaned = value.trim();
  if (!cleaned) return "@unknown";
  return cleaned.startsWith("@") ? cleaned : `@${cleaned}`;
}

function normalizeText(value?: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@[a-z0-9_]{1,15}/gi, "")
    .replace(/[#＃]/g, "")
    .replace(/\s+/g, "")
    .replace(/[　\r\n\t]/g, "")
    .replace(/[。、,.!！?？「」『』（）()【】\[\]・…〜~ー\-_:：;；"'“”‘’]/g, "")
    .trim();
}

function extractStatusId(url?: string) {
  if (!url) return null;
  const match = url.match(/status\/(\d+)/);
  return match?.[1] ?? null;
}

function makePostId(post: YahooImportPost) {
  const statusId = extractStatusId(post.url);

  if (statusId) {
    return `yahoo_${statusId}`;
  }

  const hash = createHash("sha256")
    .update(`${post.authorHandle ?? ""}|${post.text ?? ""}|${post.url ?? ""}`)
    .digest("hex")
    .slice(0, 32);

  return `yahoo_${hash}`;
}

function makeBigrams(text: string) {
  const result = new Set<string>();

  if (text.length < 2) {
    if (text) result.add(text);
    return result;
  }

  for (let i = 0; i < text.length - 1; i++) {
    result.add(text.slice(i, i + 2));
  }

  return result;
}

function diceSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aBigrams = makeBigrams(a);
  const bBigrams = makeBigrams(b);

  let intersection = 0;

  for (const item of aBigrams) {
    if (bBigrams.has(item)) intersection += 1;
  }

  return (2 * intersection) / (aBigrams.size + bBigrams.size);
}

function isNearDuplicateText(newText: string, existingText: string) {
  const a = normalizeText(newText);
  const b = normalizeText(existingText);

  if (!a || !b) return false;

  // 短すぎる投稿は誤判定しやすいので、かなり厳しめにする
  if (a.length < 18 || b.length < 18) {
    return a === b;
  }

  if (a === b) return true;

  const shorter = a.length < b.length ? a : b;
  const longer = a.length >= b.length ? a : b;

  // 片方が少し欠けているだけなら重複扱い
  const containment = longer.includes(shorter)
    ? shorter.length / longer.length
    : 0;

  if (containment >= 0.85) return true;

  const similarity = diceSimilarity(a, b);

  return similarity >= 0.88;
}

function isDuplicatePost(post: YahooImportPost, xPostId: string, existingPosts: ExistingPost[]) {
  const incomingUrl = post.url ?? "";
  const incomingStatusId = extractStatusId(incomingUrl);
  const incomingHandle = normalizeHandle(post.authorHandle).toLowerCase();
  const incomingText = String(post.text ?? "");

  for (const existing of existingPosts) {
    const existingUrl = existing.source_url ?? "";
    const existingStatusId =
      extractStatusId(existingUrl) ?? existing.x_post_id.replace(/^yahoo_/, "");

    if (incomingStatusId && existingStatusId && incomingStatusId === existingStatusId) {
      return {
        isDuplicate: true,
        reason: "same_status_id",
      };
    }

    if (incomingUrl && existingUrl && incomingUrl === existingUrl) {
      return {
        isDuplicate: true,
        reason: "same_source_url",
      };
    }

    const existingHandle = normalizeHandle(existing.author_handle ?? "").toLowerCase();

    // 同じ投稿者っぽい場合は本文類似で重複判定
    if (
      incomingHandle !== "@unknown" &&
      existingHandle !== "@unknown" &&
      incomingHandle === existingHandle &&
      isNearDuplicateText(incomingText, existing.text ?? "")
    ) {
      return {
        isDuplicate: true,
        reason: "similar_text_same_author",
      };
    }

    // 投稿者が取れていない場合でも、本文がかなり似ていれば重複扱い
    if (
      (incomingHandle === "@unknown" || existingHandle === "@unknown") &&
      isNearDuplicateText(incomingText, existing.text ?? "")
    ) {
      return {
        isDuplicate: true,
        reason: "similar_text_unknown_author",
      };
    }
  }

  return {
    isDuplicate: false,
    reason: null,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request: Request) {
  try {
    const secret = request.headers.get("x-import-secret");
    const importSecret = process.env.IMPORT_SECRET;

    if (!importSecret) {
      return NextResponse.json(
        { error: "IMPORT_SECRET is missing" },
        { status: 500, headers: corsHeaders() }
      );
    }

    if (secret !== importSecret) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders() }
      );
    }

    const body = await request.json();
    const sourceLabel = String(body.sourceLabel ?? "外部取り込み");
    const posts = Array.isArray(body.posts) ? (body.posts as YahooImportPost[]) : [];

    if (posts.length === 0) {
      return NextResponse.json(
        { ok: true, imported: 0, skippedDuplicates: 0, errors: [], message: "No posts" },
        { headers: corsHeaders() }
      );
    }

    const { data: existingPosts, error: existingError } = await supabaseAdmin
      .from("x_posts")
      .select("id, x_post_id, author_handle, text, source_url")
      .order("posted_at", { ascending: false })
      .limit(3000);

    if (existingError) {
      throw new Error(existingError.message);
    }

    let imported = 0;
    let skippedDuplicates = 0;
    const duplicateReasons: Record<string, number> = {};
    const errors: string[] = [];

    const localExistingPosts: ExistingPost[] = [...(existingPosts ?? [])];

    for (const post of posts) {
      try {
        const text = String(post.text ?? "").trim();

        if (!text) continue;

        const authorHandle = normalizeHandle(post.authorHandle);
        const xPostId = makePostId(post);

        const duplicateCheck = isDuplicatePost(post, xPostId, localExistingPosts);

        if (duplicateCheck.isDuplicate) {
          skippedDuplicates += 1;

          const reason = duplicateCheck.reason ?? "unknown";
          duplicateReasons[reason] = (duplicateReasons[reason] ?? 0) + 1;

          continue;
        }

        const media = Array.isArray(post.media)
          ? post.media
              .filter((media) => media?.url)
              .map((media, index) => ({
                media_key: media.media_key ?? `${xPostId}_media_${index}`,
                type: "photo",
                url: media.url ?? null,
                preview_image_url: media.preview_image_url ?? media.url ?? null,
                video_url: null,
                width: media.width ?? null,
                height: media.height ?? null,
              }))
          : [];

        const row = {
          x_post_id: xPostId,
          author_id: null,
          author_handle: authorHandle,
          author_name: post.authorName?.trim() || authorHandle,
          author_profile: null,
          text,
          posted_at: post.postedAt || new Date().toISOString(),
          source_type: "yahoo_realtime",
          source_label: sourceLabel,
          source_url: post.url ?? null,
          media,
          raw: {
            imported_from: "external_page_import",
            url: post.url ?? null,
            post,
          },
        };

        const { error } = await supabaseAdmin.from("x_posts").upsert(row, {
          onConflict: "x_post_id",
        });

        if (error) throw new Error(error.message);

        imported += 1;

        // 同じ取り込みリクエスト内での重複も防ぐ
        localExistingPosts.unshift({
          id: xPostId,
          x_post_id: xPostId,
          author_handle: authorHandle,
          text,
          source_url: post.url ?? null,
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return NextResponse.json(
      {
        ok: true,
        received: posts.length,
        imported,
        skippedDuplicates,
        duplicateReasons,
        errors,
      },
      { headers: corsHeaders() }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}
