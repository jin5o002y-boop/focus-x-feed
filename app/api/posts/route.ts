import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function chunkArray<T>(array: T[], size: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;
}

export async function GET() {
  try {
    const { data: posts, error: postsError } = await supabaseAdmin
      .from("x_posts")
      .select(`
        id,
        x_post_id,
        author_handle,
        author_name,
        text,
        posted_at,
        source_type,
        source_label,
        source_url,
        media,
        is_archived
      `)
      .order("posted_at", { ascending: false })
      .limit(1000);

    if (postsError) {
      return NextResponse.json(
        {
          error: postsError.message,
          details: postsError,
          step: "fetch_posts",
        },
        { status: 500 }
      );
    }

    const postIds = (posts ?? []).map((post) => post.id);

    if (postIds.length === 0) {
      return NextResponse.json({ posts: [] });
    }

    const classifications: any[] = [];

    for (const chunk of chunkArray(postIds, 100)) {
      const { data, error } = await supabaseAdmin
        .from("post_classifications")
        .select(`
          post_id,
          classification,
          reason,
          sentiment,
          main_subject,
          is_target_context,
          matched_keywords,
          matched_mute_words
        `)
        .in("post_id", chunk);

      if (error) {
        return NextResponse.json(
          {
            error: error.message,
            details: error,
            step: "fetch_classifications",
          },
          { status: 500 }
        );
      }

      classifications.push(...(data ?? []));
    }

    const classificationMap = new Map(
      classifications.map((item) => [item.post_id, item])
    );

    const mergedPosts = (posts ?? []).map((post) => {
      const classification = classificationMap.get(post.id);

      return {
        ...post,
        post_classifications: classification ? [classification] : [],
      };
    });

    return NextResponse.json({ posts: mergedPosts });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        step: "unexpected",
      },
      { status: 500 }
    );
  }
}
