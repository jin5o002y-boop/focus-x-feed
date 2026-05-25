import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const targetContext = `
対象キーワードが指すもの：
ジスは、HANAに所属する人物名。
HANA界隈で使われる呼び方で、同名のアーティスト・アイドルとは別。
プロフィールや投稿文脈にHANA、ハニーズ、HONEYs、BMSGが含まれる場合は対象の可能性が高い。
`;

const showRule = `
表示したい投稿：
ジス本人について肯定的に語っている投稿。
ジスのパフォーマンス、発言、活動、魅力、成果を好意的に評価している投稿。
`;

const maskRule = `
マスキングしたい投稿：
- ジスを批判している投稿
- ジスを心配・不安視している投稿
- ジスがかわいそう、ジス大丈夫かな、という文脈の投稿
- 一見ジスを褒めているが、実際には他の人物を褒めている投稿
- 「ジスが良いのは前提として、今回はBが良すぎる」のように主語が他者へ移っている投稿
- ジスを比較材料として扱っている投稿
- HANAのジスと同名の別対象について語っている投稿
`;

type ClassificationResult = {
  classification: "show" | "mask" | "exclude" | "unknown";
  reason: string;
  matched_keywords: string[];
  matched_mute_words: string[];
  is_target_context: boolean;
  sentiment:
    | "positive"
    | "neutral"
    | "negative"
    | "concern"
    | "other"
    | "unknown";
  main_subject: string;
};

async function classifyPost(input: {
  text: string;
  authorHandle: string;
  authorName: string | null;
  authorProfile: string | null;
  sourceType: string;
  sourceLabel: string | null;
  keywords: string[];
  muteWords: string[];
}): Promise<ClassificationResult> {
  const prompt = `
あなたはX投稿のフィルタリング判定AIです。
ユーザーが見たい投稿だけを表示し、不快または目的外の投稿は隠します。

${targetContext}

${showRule}

${maskRule}

判定ルール：
1. ミュートワードを含む投稿は exclude。
2. HANAのジスではない別対象の投稿は exclude。
3. HANAのジス本人を肯定的に語っている投稿は show。
4. 批判、心配、不安視、かわいそう、大丈夫かな、比較材料扱いは mask。
5. 一見ジスを褒めていても主語や称賛対象が他者に移っている投稿は mask。
6. 判断に迷う場合は unknown ではなく、ユーザーの安全側に倒して mask。
7. 収集対象アカウントの投稿でも、mask条件に当てはまる場合は mask。

出力はJSONのみ。
余計な説明は一切出さないでください。

JSON形式：
{
  "classification": "show | mask | exclude | unknown",
  "reason": "短い判定理由",
  "matched_keywords": ["一致したキーワード"],
  "matched_mute_words": ["一致したミュートワード"],
  "is_target_context": true,
  "sentiment": "positive | neutral | negative | concern | other | unknown",
  "main_subject": "投稿の主な称賛対象・話題対象"
}

判定対象：
投稿者: ${input.authorHandle}
表示名: ${input.authorName ?? ""}
プロフィール: ${input.authorProfile ?? ""}
取得元: ${input.sourceType}
取得ラベル: ${input.sourceLabel ?? ""}
対象キーワード一覧: ${input.keywords.join(", ")}
ミュートワード一覧: ${input.muteWords.join(", ")}

投稿本文：
${input.text}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI response is empty");
  }

  const parsed = JSON.parse(content) as ClassificationResult;

  return {
    classification: parsed.classification ?? "unknown",
    reason: parsed.reason ?? "",
    matched_keywords: parsed.matched_keywords ?? [],
    matched_mute_words: parsed.matched_mute_words ?? [],
    is_target_context: Boolean(parsed.is_target_context),
    sentiment: parsed.sentiment ?? "unknown",
    main_subject: parsed.main_subject ?? "",
  };
}

export async function POST() {
  try {
    const [classifiedResult, keywordsResult, muteWordsResult] =
      await Promise.all([
        supabaseAdmin.from("post_classifications").select("post_id"),
        supabaseAdmin
          .from("target_keywords")
          .select("keyword")
          .eq("is_active", true),
        supabaseAdmin.from("mute_words").select("word").eq("is_active", true),
      ]);

    if (classifiedResult.error) throw new Error(classifiedResult.error.message);
    if (keywordsResult.error) throw new Error(keywordsResult.error.message);
    if (muteWordsResult.error) throw new Error(muteWordsResult.error.message);

    const classifiedPostIds = new Set(
      (classifiedResult.data ?? []).map((item) => item.post_id)
    );

    const { data: candidatePosts, error: postsError } = await supabaseAdmin
      .from("x_posts")
      .select(`
        id,
        text,
        author_handle,
        author_name,
        author_profile,
        source_type,
        source_label,
        posted_at
      `)
      .order("posted_at", { ascending: false })
      .limit(100);

    if (postsError) throw new Error(postsError.message);

    const posts = (candidatePosts ?? [])
      .filter((post) => !classifiedPostIds.has(post.id))
      .slice(0, 30);

    const keywords = (keywordsResult.data ?? []).map((item) => item.keyword);
    const muteWords = (muteWordsResult.data ?? []).map((item) => item.word);

    let classified = 0;
    const errors: string[] = [];

    for (const post of posts) {
      try {
        const result = await classifyPost({
          text: post.text,
          authorHandle: post.author_handle,
          authorName: post.author_name,
          authorProfile: post.author_profile,
          sourceType: post.source_type,
          sourceLabel: post.source_label,
          keywords,
          muteWords,
        });

        const { error } = await supabaseAdmin
          .from("post_classifications")
          .upsert(
            {
              post_id: post.id,
              classification: result.classification,
              reason: result.reason,
              matched_keywords: result.matched_keywords,
              matched_mute_words: result.matched_mute_words,
              is_target_context: result.is_target_context,
              sentiment: result.sentiment,
              main_subject: result.main_subject,
            },
            { onConflict: "post_id" }
          );

        if (error) throw new Error(error.message);

        classified += 1;
      } catch (error) {
        errors.push(
          `${post.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return NextResponse.json({
      ok: true,
      classified,
      remainingBeforeThisRun: Math.max(
        0,
        (candidatePosts ?? []).filter((post) => !classifiedPostIds.has(post.id))
          .length - classified
      ),
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
