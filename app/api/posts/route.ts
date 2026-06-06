import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
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
    return NextResponse.json({ error: postsError.message }, { status: 500 });
  }

  const postIds = (posts ?? []).map((post) => post.id);

  if (postIds.length === 0) {
    return NextResponse.json({ posts: [] });
  }

  const { data: classifications, error: classificationsError } =
    await supabaseAdmin
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
      .in("post_id", postIds);

  if (classificationsError) {
    return NextResponse.json(
      { error: classificationsError.message },
      { status: 500 }
    );
  }

  const classificationMap = new Map(
    (classifications ?? []).map((item) => [item.post_id, item])
  );

  const mergedPosts = (posts ?? []).map((post) => {
    const classification = classificationMap.get(post.id);

    return {
      ...post,
      post_classifications: classification ? [classification] : [],
    };
  });

  return NextResponse.json({ posts: mergedPosts });
}
