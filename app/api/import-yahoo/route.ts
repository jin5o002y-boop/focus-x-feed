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
    const sourceLabel = String(body.sourceLabel ?? "Yahooリアルタイム検索");
    const posts = Array.isArray(body.posts) ? (body.posts as YahooImportPost[]) : [];

    if (posts.length === 0) {
      return NextResponse.json(
        { ok: true, imported: 0, message: "No posts" },
        { headers: corsHeaders() }
      );
    }

    let imported = 0;
    const errors: string[] = [];

    for (const post of posts) {
      try {
        const text = String(post.text ?? "").trim();

        if (!text) continue;

        const authorHandle = normalizeHandle(post.authorHandle);
        const xPostId = makePostId(post);

        const { error } = await supabaseAdmin.from("x_posts").upsert(
          {
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
            media: Array.isArray(post.media)
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
              : [],
            raw: {
              imported_from: "yahoo_realtime",
              url: post.url ?? null,
              post,
            },
          },
          {
            onConflict: "x_post_id",
          }
        );

        if (error) throw new Error(error.message);

        imported += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return NextResponse.json(
      {
        ok: true,
        imported,
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
