import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { postId, isArchived } = body;

    if (!postId || typeof isArchived !== "boolean") {
      return NextResponse.json(
        { error: "postId and isArchived are required" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("x_posts")
      .update({ is_archived: isArchived })
      .eq("id", postId);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
