import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const allowedFeedback = new Set([
  "should_show",
  "should_mask",
  "should_exclude",
  "wrong_context",
]);

function feedbackToClassification(feedback: string, note?: string) {
  const suffix = note ? ` / 補足: ${note}` : "";

  if (feedback === "should_show") {
    return {
      classification: "show",
      reason: `ユーザーが「これは見たい」とフィードバックしたため表示に変更${suffix}`,
      sentiment: "positive",
      is_target_context: true,
      main_subject: "ユーザーフィードバックにより表示対象",
    };
  }

  if (feedback === "should_mask") {
    return {
      classification: "mask",
      reason: `ユーザーが「これは隠したい」とフィードバックしたためマスキングに変更${suffix}`,
      sentiment: "other",
      is_target_context: true,
      main_subject: "ユーザーフィードバックによりマスキング対象",
    };
  }

  if (feedback === "should_exclude") {
    return {
      classification: "exclude",
      reason: `ユーザーが「これは除外でいい」とフィードバックしたため除外に変更${suffix}`,
      sentiment: "other",
      is_target_context: false,
      main_subject: "ユーザーフィードバックにより除外対象",
    };
  }

  if (feedback === "wrong_context") {
    return {
      classification: "exclude",
      reason: `ユーザーが「文脈違い」とフィードバックしたため除外に変更${suffix}`,
      sentiment: "other",
      is_target_context: false,
      main_subject: "文脈違い",
    };
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { postId, feedback, note } = body;

    if (!postId || !feedback) {
      return NextResponse.json(
        { error: "postId and feedback are required" },
        { status: 400 }
      );
    }

    if (!allowedFeedback.has(feedback)) {
      return NextResponse.json(
        { error: "invalid feedback" },
        { status: 400 }
      );
    }

    const safeNote = typeof note === "string" ? note.trim() : "";
    const classificationUpdate = feedbackToClassification(feedback, safeNote);

    if (!classificationUpdate) {
      return NextResponse.json(
        { error: "failed to map feedback" },
        { status: 400 }
      );
    }

    const { error: feedbackError } = await supabaseAdmin
      .from("user_feedback")
      .insert({
        post_id: postId,
        feedback,
        note: safeNote || null,
      });

    if (feedbackError) {
      throw new Error(feedbackError.message);
    }

    const { error: classificationError } = await supabaseAdmin
      .from("post_classifications")
      .upsert(
        {
          post_id: postId,
          classification: classificationUpdate.classification,
          reason: classificationUpdate.reason,
          matched_keywords: [],
          matched_mute_words: [],
          is_target_context: classificationUpdate.is_target_context,
          sentiment: classificationUpdate.sentiment,
          main_subject: classificationUpdate.main_subject,
        },
        {
          onConflict: "post_id",
        }
      );

    if (classificationError) {
      throw new Error(classificationError.message);
    }

    return NextResponse.json({
      ok: true,
      classification: classificationUpdate.classification,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
