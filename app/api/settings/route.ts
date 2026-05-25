import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const [
    sourceAccounts,
    blockAccounts,
    muteWords,
    targetKeywords,
    appSettings,
  ] = await Promise.all([
    supabaseAdmin.from("x_source_accounts").select("*").order("created_at"),
    supabaseAdmin.from("x_block_accounts").select("*").order("created_at"),
    supabaseAdmin.from("mute_words").select("*").order("created_at"),
    supabaseAdmin.from("target_keywords").select("*").order("created_at"),
    supabaseAdmin.from("app_settings").select("*"),
  ]);

  const errors = [
    sourceAccounts.error,
    blockAccounts.error,
    muteWords.error,
    targetKeywords.error,
    appSettings.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    return NextResponse.json(
      { error: errors.map((e) => e?.message).join(" / ") },
      { status: 500 }
    );
  }

  return NextResponse.json({
    sourceAccounts: sourceAccounts.data ?? [],
    blockAccounts: blockAccounts.data ?? [],
    muteWords: muteWords.data ?? [],
    targetKeywords: targetKeywords.data ?? [],
    appSettings: appSettings.data ?? [],
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { type, value, description } = body;

  if (!type || !value) {
    return NextResponse.json(
      { error: "type and value are required" },
      { status: 400 }
    );
  }

  const normalizedValue =
    typeof value === "string" ? value.trim() : String(value).trim();

  if (!normalizedValue) {
    return NextResponse.json(
      { error: "value is empty" },
      { status: 400 }
    );
  }

  if (type === "source_account") {
    const handle = normalizedValue.startsWith("@")
      ? normalizedValue
      : `@${normalizedValue}`;

    const { error } = await supabaseAdmin
      .from("x_source_accounts")
      .upsert({ handle, is_active: true }, { onConflict: "handle" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (type === "block_account") {
    const handle = normalizedValue.startsWith("@")
      ? normalizedValue
      : `@${normalizedValue}`;

    const { error } = await supabaseAdmin
      .from("x_block_accounts")
      .upsert({ handle, is_active: true }, { onConflict: "handle" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (type === "mute_word") {
    const { error } = await supabaseAdmin
      .from("mute_words")
      .upsert({ word: normalizedValue, is_active: true }, { onConflict: "word" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (type === "target_keyword") {
    const { error } = await supabaseAdmin
      .from("target_keywords")
      .upsert(
        {
          keyword: normalizedValue,
          description: description ?? null,
          is_active: true,
        },
        { onConflict: "keyword" }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
