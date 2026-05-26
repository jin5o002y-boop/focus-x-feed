import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function callInternalApi(path: string, baseUrl: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    cache: "no-store",
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`${path} failed: ${JSON.stringify(json)}`);
  }

  return json;
}

export async function GET(request: Request) {
  const startedAt = new Date().toISOString();
  let logId: string | null = null;

  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      return NextResponse.json(
        { error: "CRON_SECRET is missing" },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: logData, error: logError } = await supabaseAdmin
      .from("cron_logs")
      .insert({
        job_name: "fetch-and-classify",
        status: "success",
        started_at: startedAt,
      })
      .select("id")
      .single();

    if (logError) {
      throw new Error(logError.message);
    }

    logId = logData.id;

    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    const fetchResult = await callInternalApi("/api/fetch", baseUrl);
    const classifyResult = await callInternalApi("/api/classify", baseUrl);

    await supabaseAdmin
      .from("cron_logs")
      .update({
        status: "success",
        fetch_result: fetchResult,
        classify_result: classifyResult,
        finished_at: new Date().toISOString(),
      })
      .eq("id", logId);

    return NextResponse.json({
      ok: true,
      fetchResult,
      classifyResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (logId) {
      await supabaseAdmin
        .from("cron_logs")
        .update({
          status: "error",
          error_message: message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", logId);
    } else {
      await supabaseAdmin.from("cron_logs").insert({
        job_name: "fetch-and-classify",
        status: "error",
        error_message: message,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
