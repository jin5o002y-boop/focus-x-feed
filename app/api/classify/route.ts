import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const jisooKeywords = [
  "JISOO",
  "ジスオンニ",
  "ジスたむ",
  "ジスマヒ",
  "ジスさん",
  "ジスちゃん",
  "じすまひ",
  "じすたむ",
  "じすおんに",
  "じすちゃん",
  "ジス",
  "じす",
];

const hanaProfilePositiveWords = [
  "HANA",
  "はにーず",
  "honeys",
  "HONEYs",
  "Honeys",
  "ハニーズ",
  "JISOO",
  "ジス",
  "じす",
];

const nonHanaProfileWords = [
  "ブラックピンク",
  "BLACKPINK",
  "BLINK",
  "MOA",
  "セブチ",
  "SEVENTEEN",
  "TOMORROW X TOGETHER",
  "TXT",
  "トゥバ",
  "幽幻士ジス",
];

const otherMemberWords = [
  "チカ",
  "ちか",
  "CHIKA",
  "直子",
  "なお",
  "なおこ",
  "NAOKO",
  "ナオ",
  "ナオコ",
  "ゆり",
  "YURI",
  "ユリ",
  "ももか",
  "もも",
  "モモカ",
  "モモ",
  "MOMOKA",
  "まひな",
  "まひ",
  "マヒナ",
  "マヒ",
  "MAHI",
  "MAHINA",
  "こはる",
  "こは",
  "コハル",
  "コハ",
];

const positiveWords = [
  "好き",
  "かわいい",
  "可愛い",
  "愛",
  "メロい",
  "良い",
  "いい",
  "面白い",
  "上手い",
  "うまい",
  "圧倒",
  "感動",
  "泣ける",
  "最高",
  "すごい",
  "凄い",
  "素敵",
  "魅力",
  "優勝",
];

const relativizeWords = [
  "今回はジスより",
  "ジスよりも",
  "結局選べない",
  "どっちも良い",
  "どっちもいい",
  "束推し",
  "箱推し",
  "全員好き",
  "全員良い",
  "全員いい",
];

const targetContext = `
対象キーワードが指すもの：
ジスは、HANAに所属する人物名。
HANA界隈で使われる呼び方で、同名のアーティスト・アイドルとは別。
プロフィールや投稿文脈にHANA、ハニーズ、HONEYs、BMSG、はにーずが含まれる場合は対象の可能性が高い。
`;

const showRule = `
表示したい投稿：
HANAのジス本人について肯定的に語っている投稿。
ジスのパフォーマンス、発言、活動、魅力、成果、画像、ビジュアル、表情を好意的に評価している投稿。
画像付き投稿で本文にジス系キーワードがなくても、画像がHANAのジスを指すと判断でき、文章が肯定的であれば show。
`;

const maskRule = `
マスキングしたい投稿：
- ジスを批判している投稿
- ジスを心配・不安視している投稿
- ジスがかわいそう、ジス大丈夫かな、という文脈の投稿
- 一見ジスを褒めているが、実際には他の人物を褒めている投稿
- 「ジスが良いのは前提として、今回はBが良すぎる」のように主語が他者へ移っている投稿
- ジスを比較材料として扱っている投稿
- ジス系キーワードがない投稿で、他メンバー名が含まれ、内容がポジティブな投稿
- ジスが相対化される投稿。例：今回はジスよりも、結局選べない、箱推し、全員好き、どっちも良い
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

type FeedbackExample = {
  feedback: string;
  note: string | null;
  post_text: string | null;
  author_handle: string | null;
  media: unknown;
};

type MediaItem = {
  media_key?: string;
  type?: string;
  url?: string | null;
  preview_image_url?: string | null;
  video_url?: string | null;
  width?: number | null;
  height?: number | null;
};

function includesAny(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

function hasPositiveNearJisoo(text: string) {
  const normalized = text.replace(/\s+/g, "");
  const jisooPattern = /(ジス|じす|JISOO)/gi;

  let match: RegExpExecArray | null;

  while ((match = jisooPattern.exec(normalized)) !== null) {
    const start = Math.max(0, match.index - 10);
    const end = Math.min(normalized.length, match.index + match[0].length + 10);
    const nearby = normalized.slice(start, end);

    if (includesAny(nearby, positiveWords)) {
      return true;
    }
  }

  return false;
}

function preClassify(input: {
  text: string;
  authorProfile: string | null;
  mediaUrls: string[];
}) {
  const text = input.text;
  const profile = input.authorProfile ?? "";
  const hasJisooKeyword = includesAny(text, jisooKeywords);
  const hasOtherMember = includesAny(text, otherMemberWords);
  const hasRelativize = includesAny(text, relativizeWords);
  const profileLooksHana = includesAny(profile, hanaProfilePositiveWords);
  const profileLooksOther = includesAny(profile, nonHanaProfileWords);
  const positiveNearJisoo = hasPositiveNearJisoo(text);

  if (profileLooksOther) {
    return {
      classification: "exclude" as const,
      reason:
        "投稿主プロフィールにBLACKPINK/BLINK/TXT/幽幻士ジス等の別文脈ワードがあるため、HANAのジスではない可能性が高い",
      is_target_context: false,
      sentiment: "other" as const,
      main_subject: "文脈違い",
    };
  }

  if (hasJisooKeyword && hasRelativize) {
    return {
      classification: "mask" as const,
      reason:
        "ジス系キーワードを含むが、ジスが他メンバーや箱推し文脈の中で相対化されているためマスキング",
      is_target_context: true,
      sentiment: "other" as const,
      main_subject: "ジスを含む相対化投稿",
    };
  }

  if (hasJisooKeyword && positiveNearJisoo && hasOtherMember) {
    return {
      classification: "mask" as const,
      reason:
        "ジス近傍にポジティブ語があるが、その後に他メンバー名も続くため、主語が他者へ移る可能性が高くマスキング",
      is_target_context: true,
      sentiment: "other" as const,
      main_subject: "ジスと他メンバーの混在投稿",
    };
  }

  if (!hasJisooKeyword && hasOtherMember) {
    return {
      classification: "mask" as const,
      reason:
        "ジス系キーワードを含まず、他メンバー名を含むため、ポジティブ投稿でもマスキング",
      is_target_context: false,
      sentiment: "other" as const,
      main_subject: "他メンバー",
    };
  }

  if (hasJisooKeyword && profileLooksHana) {
    return null;
  }

  return null;
}

function buildFeedbackGuide(examples: FeedbackExample[]) {
  if (examples.length === 0) {
    return `
過去のユーザーフィードバック：
まだありません。
`;
  }

  const lines = examples
    .map((example, index) => {
      const label =
        example.feedback === "should_show"
          ? "表示したい"
          : example.feedback === "should_mask"
            ? "マスキングしたい"
            : example.feedback === "should_exclude"
              ? "除外したい"
              : "文脈違いとして除外したい";

      const note = example.note?.trim()
        ? example.note.trim()
        : "理由メモなし";

      const text = example.post_text
        ? example.post_text.replace(/\s+/g, " ").slice(0, 180)
        : "";

      const hasImageNote =
        note.includes("画像") ||
        note.includes("ジスを指す") ||
        note.includes("ジスの画像");

      return `${index + 1}. 判定補正: ${label}
理由メモ: ${note}
画像判定に関係するメモか: ${hasImageNote ? "はい" : "いいえ"}
投稿者: ${example.author_handle ?? ""}
投稿例: ${text}`;
    })
    .join("\n\n");

  return `
過去のユーザーフィードバック：
以下は、ユーザーが実際に判定を修正した履歴です。
新しい投稿を判定するときは、この履歴を強く参考にしてください。
特に「この画像はジスを指す」「ジスの画像を用いている」といった画像に関する理由メモがある場合、類似した画像付き投稿の判定で重視してください。
ただし、完全一致ではなく、同じ文脈・同じニュアンス・同じ主語ズレ・同じ不安視表現がある場合に反映してください。

${lines}
`;
}

async function classifyPost(input: {
  text: string;
  authorHandle: string;
  authorName: string | null;
  authorProfile: string | null;
  sourceType: string;
  sourceLabel: string | null;
  keywords: string[];
  muteWords: string[];
  feedbackGuide: string;
  media: MediaItem[];
}): Promise<ClassificationResult> {
  const mediaUrls = input.media
    .map((item) => item.url || item.preview_image_url)
    .filter(Boolean)
    .slice(0, 4) as string[];

  const pre = preClassify({
    text: input.text,
    authorProfile: input.authorProfile,
    mediaUrls,
  });

  if (pre) {
    return {
      classification: pre.classification,
      reason: pre.reason,
      matched_keywords: input.keywords.filter((keyword) =>
        input.text.toLowerCase().includes(keyword.toLowerCase())
      ),
      matched_mute_words: input.muteWords.filter((word) =>
        input.text.toLowerCase().includes(word.toLowerCase())
      ),
      is_target_context: pre.is_target_context,
      sentiment: pre.sentiment,
      main_subject: pre.main_subject,
    };
  }

  const imageInstruction =
    mediaUrls.length > 0
      ? `
画像付き投稿です。
以下の画像URLも判定材料にしてください。
画像内の人物・雰囲気・文脈がHANAのジスを指すと判断でき、本文が肯定的なら、ジス系キーワードが本文になくても show にしてください。
画像がHANAのジスか判断できない場合は、本文・投稿者プロフィール・過去フィードバックを優先してください。

画像URL:
${mediaUrls.map((url, index) => `${index + 1}. ${url}`).join("\n")}
`
      : `
画像はありません。
`;

  const prompt = `
あなたはX投稿のフィルタリング判定AIです。
ユーザーが見たい投稿だけを表示し、不快または目的外の投稿は隠します。

${targetContext}

${showRule}

${maskRule}

${input.feedbackGuide}

${imageInstruction}

ジス系キーワード一覧：
${jisooKeywords.join(", ")}

HANA文脈と判定しやすいプロフィール語：
${hanaProfilePositiveWords.join(", ")}

HANAのジスではないと判定しやすいプロフィール語：
${nonHanaProfileWords.join(", ")}

他メンバー名一覧：
${otherMemberWords.join(", ")}

ポジティブ語一覧：
${positiveWords.join(", ")}

相対化表現一覧：
${relativizeWords.join(", ")}

追加判定ルール：
1. ミュートワードを含む投稿は exclude。
2. HANAのジスではない別対象の投稿は exclude。
3. 投稿主プロフィールに「ブラックピンク」「BLACKPINK」「BLINK」「MOA」「セブチ」「SEVENTEEN」「TOMORROW X TOGETHER」「TXT」「トゥバ」「幽幻士ジス」があれば、原則 exclude。
4. 投稿主プロフィールに「HANA」「はにーず」「honeys」「HONEYs」「Honeys」「ハニーズ」「JISOO」「ジス」「じす」があれば、HANAのジス文脈の可能性を高く見る。
5. HANAのジス本人を肯定的に語っている投稿は show。
6. 画像付き投稿で、本文にジス系キーワードがなくても、画像がジスを指し、本文が肯定的なら show。
7. 批判、心配、不安視、かわいそう、大丈夫かな、比較材料扱いは mask。
8. 一見ジスを褒めていても主語や称賛対象が他者に移っている投稿は mask。
9. 「ジス」「JISOO」「じす」の近くにポジティブ語があり、その後に他メンバー名が続く場合は、ジスが相対化されている可能性があるため mask。
10. 「今回はジスよりも」「結局選べない」「どっちも良い」「束推し」「箱推し」「全員好き」など、ジスが相対化される投稿は mask。
11. ジス系キーワードがなく、他メンバー名がある投稿は、内容がポジティブでも原則 mask。
12. ジス系キーワードも他メンバー名もなく、画像でも判断できない場合は unknown。
13. 収集対象アカウントの投稿でも、mask条件に当てはまる場合は mask。
14. 過去のユーザーフィードバックに似た文脈がある場合は、その判断を優先する。
15. 「除外」は対象外・別界隈・文脈違い・ミュート対象に使う。
16. 「マスキング」は対象には関係あるが、ユーザーが見たくない可能性が高い投稿に使う。

出力はJSONのみ。
余計な説明は一切出さないでください。

JSON形式：
{
  "classification": "show | mask | exclude | unknown",
  "reason": "短い判定理由。画像や過去フィードバックを参考にした場合はその要点も含める",
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

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: prompt,
        },
        ...mediaUrls.map((url) => ({
          type: "image_url" as const,
          image_url: {
            url,
            detail: "low" as const,
          },
        })),
      ],
    },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages,
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
    const [
      classifiedResult,
      keywordsResult,
      muteWordsResult,
      feedbackResult,
    ] = await Promise.all([
      supabaseAdmin.from("post_classifications").select("post_id"),
      supabaseAdmin
        .from("target_keywords")
        .select("keyword")
        .eq("is_active", true),
      supabaseAdmin.from("mute_words").select("word").eq("is_active", true),
      supabaseAdmin
        .from("user_feedback")
        .select(`
          feedback,
          note,
          created_at,
          x_posts (
            text,
            author_handle,
            media
          )
        `)
        .not("note", "is", null)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (classifiedResult.error) throw new Error(classifiedResult.error.message);
    if (keywordsResult.error) throw new Error(keywordsResult.error.message);
    if (muteWordsResult.error) throw new Error(muteWordsResult.error.message);
    if (feedbackResult.error) throw new Error(feedbackResult.error.message);

    const feedbackExamples: FeedbackExample[] = (feedbackResult.data ?? []).map(
      (item: any) => ({
        feedback: item.feedback,
        note: item.note,
        post_text: item.x_posts?.text ?? null,
        author_handle: item.x_posts?.author_handle ?? null,
        media: item.x_posts?.media ?? null,
      })
    );

    const feedbackGuide = buildFeedbackGuide(feedbackExamples);

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
        posted_at,
        media
      `)
      .order("posted_at", { ascending: false })
      .limit(1000);

    if (postsError) throw new Error(postsError.message);

    const posts = (candidatePosts ?? [])
      .filter((post) => !classifiedPostIds.has(post.id))
      .slice(0, 30);

    const keywords = Array.from(
      new Set([
        ...(keywordsResult.data ?? []).map((item) => item.keyword),
        ...jisooKeywords,
      ])
    );

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
          feedbackGuide,
          media: Array.isArray(post.media) ? post.media : [],
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
      feedbackExamplesUsed: feedbackExamples.length,
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
