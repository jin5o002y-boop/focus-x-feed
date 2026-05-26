import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normalizeHandle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function splitBulkText(value: string) {
  return value
    .split(/\n|,|、|\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getTableName(type: string) {
  if (type === "source_account") return "x_source_accounts";
  if (type === "block_account") return "x_block_accounts";
  if (type === "mute_word") return "mute_words";
  if (type === "target_keyword") return "target_keywords";
  return null;
}

async function upsertSettingItem(type: string, value: string, description?: string) {
  const normalizedValue = value.trim();

  if (!normalizedValue) return;

  if (type === "source_account") {
    const handle = normalizeHandle(normalizedValue);

    const { error } = await supabaseAdmin
      .from("x_source_accounts")
      .upsert({ handle, is_active: true }, { onConflict: "handle" });

    if (error) throw new Error(error.message);
    return;
  }

  if (type === "block_account") {
    const handle = normalizeHandle(normalizedValue);

    const { error } = await supabaseAdmin
      .from("x_block_accounts")
      .upsert({ handle, is_active: true }, { onConflict: "handle" });

    if (error) throw new Error(error.message);
    return;
  }

  if (type === "mute_word") {
    const { error } = await supabaseAdmin
      .from("mute_words")
      .upsert({ word: normalizedValue, is_active: true }, { onConflict: "word" });

    if (error) throw new Error(error.message);
    return;
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

    if (error) throw new Error(error.message);
    return;
  }

  throw new Error("invalid type");
}

export async function GET() {
  const [
    sourceAccounts,
    blockAccounts,
    muteWords,
    targetKeywords,
    appSettings,
  ] = await Promise.all([
    supabaseAdmin
      .from("x_source_accounts")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
    supabaseAdmin
      .from("x_block_accounts")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
    supabaseAdmin
      .from("mute_words")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
    supabaseAdmin
      .from("target_keywords")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
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
  try {
    const body = await request.json();
    const { type, value, description, mode } = body;

    if (!type || !value) {
      return NextResponse.json(
        { error: "type and value are required" },
        { status: 400 }
      );
    }

    const values = mode === "bulk" ? splitBulkText(String(value)) : [String(value)];

    if (values.length === 0) {
      return NextResponse.json({ error: "value is empty" }, { status: 400 });
    }

    for (const item of values) {
      await upsertSettingItem(type, item, description);
    }

    return NextResponse.json({
      ok: true,
      added: values.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { type, id } = body;

    if (!type || !id) {
      return NextResponse.json(
        { error: "type and id are required" },
        { status: 400 }
      );
    }

    const tableName = getTableName(type);

    if (!tableName) {
      return NextResponse.json(
        { error: "invalid type" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from(tableName)
      .update({ is_active: false })
      .eq("id", id);

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
