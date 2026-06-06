import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ImportMedia = {
  media_key?: string;
  type?: "photo";
  url?: string;
  preview_image_url?: string | null;
  video_url?: string | null;
  width?: number | null;
  height?: number | null;
};

type ImportPost = {
  text?: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  url?: string;
  media?: ImportMedia[];
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

function makePostId(post: ImportPost) {
  const statusId = extractStatusId(post.url);

  if (statusId) {
    return `x_profile_${statusId}`;
  }

  const hash = createHash("sha256")
    .update(`${post.authorHandle ?? ""}|${post.text ?? ""}|${post.url ?? ""}`)
    .digest("hex")
    .slice(0, 32);

  return `x_profile_${hash}`;
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
    const sourceLabel = String(body.sourceLabel ?? "Xプロフィール巡回");
    const posts = Array.isArray(body.posts) ? (body.posts as ImportPost[]) : [];

    let imported = 0;
    const errors: string[] = [];

    for (const post of posts) {
      try {
        const text = String(post.text ?? "").trim();
        if (!text) continue;

        const authorHandle = normalizeHandle(post.authorHandle);
        const xPostId = makePostId(post);

        const media = Array.isArray(post.media)
          ? post.media
              .filter((item) => item?.url)
              .map((item, index) => ({
                media_key: item.media_key ?? `${xPostId}_media_${index}`,
                type: "photo",
                url: item.url ?? null,
                preview_image_url: item.preview_image_url ?? item.url ?? null,
                video_url: null,
                width: item.width ?? null,
                height: item.height ?? null,
              }))
          : [];

        const { error } = await supabaseAdmin.from("x_posts").upsert(
          {
            x_post_id: xPostId,
            author_id: null,
            author_handle: authorHandle,
            author_name: post.authorName?.trim() || authorHandle,
            author_profile: null,
            text,
            posted_at: post.postedAt || new Date().toISOString(),
            source_type: "x_profile_page",
            source_label: sourceLabel,
            source_url: post.url ?? null,
            media,
            raw: {
              imported_from: "x_profile_page",
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
