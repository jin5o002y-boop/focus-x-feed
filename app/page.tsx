"use client";

import { useEffect, useMemo, useState } from "react";

type Classification = {
  classification: "show" | "mask" | "exclude" | "unknown";
  reason: string | null;
  sentiment: string | null;
  main_subject: string | null;
  is_target_context: boolean | null;
  matched_keywords: string[] | null;
  matched_mute_words: string[] | null;
};

type MediaItem = {
  media_key: string;
  type: "photo" | "video" | "animated_gif";
  url: string | null;
  preview_image_url: string | null;
  video_url: string | null;
  width: number | null;
  height: number | null;
};

type Post = {
  id: string;
  x_post_id: string;
  author_handle: string;
  author_name: string | null;
  text: string;
  posted_at: string | null;
  source_type: "source_account" | "keyword_search";
  source_label: string | null;
  media: MediaItem[] | null;
  post_classifications: Classification[] | null;
};

type SettingItem = {
  id: string;
  handle?: string;
  word?: string;
  keyword?: string;
  description?: string | null;
  is_active: boolean;
};

type SettingsResponse = {
  sourceAccounts: SettingItem[];
  blockAccounts: SettingItem[];
  muteWords: SettingItem[];
  targetKeywords: SettingItem[];
};

const settingTypes = [
  { value: "source_account", label: "収集対象アカウント" },
  { value: "block_account", label: "ブロック対象アカウント" },
  { value: "mute_word", label: "ミュートワード" },
  { value: "target_keyword", label: "収集対象キーワード" },
];

function getStatusLabel(classification?: Classification) {
  if (!classification) return "未判定";
  if (classification.classification === "show") return "表示";
  if (classification.classification === "mask") return "マスキング";
  if (classification.classification === "exclude") return "除外";
  return "要確認";
}

function getStatusClass(classification?: Classification) {
  if (!classification) return "border-gray-200 bg-gray-50 text-gray-600";
  if (classification.classification === "show") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (classification.classification === "mask") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (classification.classification === "exclude") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-gray-200 bg-gray-50 text-gray-600";
}

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [newType, setNewType] = useState("source_account");
  const [newValue, setNewValue] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [showMaskedText, setShowMaskedText] = useState<Record<string, boolean>>(
    {}
  );
  const [activeFilter, setActiveFilter] = useState<
    "all" | "show" | "mask" | "exclude" | "unclassified" | "media"
  >("all");

  const counts = useMemo(() => {
    const result = {
      total: posts.length,
      show: 0,
      mask: 0,
      exclude: 0,
      unknown: 0,
      unclassified: 0,
      media: 0,
    };

    for (const post of posts) {
      const classification = post.post_classifications?.[0];

      if (post.media && post.media.length > 0) {
        result.media += 1;
      }

      if (!classification) {
        result.unclassified += 1;
      } else if (classification.classification === "show") {
        result.show += 1;
      } else if (classification.classification === "mask") {
        result.mask += 1;
      } else if (classification.classification === "exclude") {
        result.exclude += 1;
      } else {
        result.unknown += 1;
      }
    }

    return result;
  }, [posts]);

  const filteredPosts = useMemo(() => {
    return posts.filter((post) => {
      const classification = post.post_classifications?.[0];

      if (activeFilter === "all") return true;
      if (activeFilter === "media") return Boolean(post.media && post.media.length > 0);
      if (activeFilter === "unclassified") return !classification;
      return classification?.classification === activeFilter;
    });
  }, [posts, activeFilter]);

  const filterTabs = [
    { value: "all", label: "すべて", count: counts.total },
    { value: "show", label: "表示", count: counts.show },
    { value: "mask", label: "マスキング", count: counts.mask },
    { value: "exclude", label: "除外", count: counts.exclude },
    { value: "unclassified", label: "未判定", count: counts.unclassified },
    { value: "media", label: "画像・動画あり", count: counts.media },
  ] as const;

  async function loadPosts() {
    const response = await fetch("/api/posts", { cache: "no-store" });
    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.error ?? "投稿の取得に失敗しました");
    }

    setPosts(json.posts ?? []);
  }

  async function loadSettings() {
    const response = await fetch("/api/settings", { cache: "no-store" });
    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.error ?? "設定の取得に失敗しました");
    }

    setSettings(json);
  }

  async function runAction(
    endpoint: "/api/fetch" | "/api/classify",
    label: string
  ) {
    try {
      setLoading(true);
      setMessage(`${label}中...`);

      const response = await fetch(endpoint, {
        method: "POST",
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error ?? `${label}に失敗しました`);
      }

      setMessage(`${label}完了: ${JSON.stringify(json)}`);
      await loadPosts();
      await loadSettings();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function addSetting() {
    try {
      setLoading(true);
      setMessage("設定を追加中...");

      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: newType,
          value: newValue,
          description: newDescription,
        }),
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error ?? "設定追加に失敗しました");
      }

      setNewValue("");
      setNewDescription("");
      setMessage("設定を追加しました");
      await loadSettings();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function sendFeedback(
    postId: string,
    feedback: "should_show" | "should_mask" | "should_exclude" | "wrong_context"
  ) {
    try {
      setLoading(true);

      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          postId,
          feedback,
        }),
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error ?? "フィードバック保存に失敗しました");
      }

      const feedbackLabel =
        feedback === "should_show"
          ? "これは見たい"
          : feedback === "should_mask"
            ? "これは隠したい"
            : feedback === "should_exclude"
              ? "これは除外でいい"
              : "文脈違い";

      setMessage(`フィードバックを保存しました: ${feedbackLabel}`);
      await loadPosts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    Promise.all([loadPosts(), loadSettings()]).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });
  }, []);

  return (
    <main className="min-h-screen bg-gray-100 px-5 py-8 text-gray-900">
      <div className="mx-auto grid max-w-7xl gap-6">
        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-500">
                Focus X Feed
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">
                見たいX投稿だけを集めるフィード
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-600">
                指定アカウント・指定キーワードから投稿を取得し、ミュートワード・ブロック対象・AI判定を通して、不要な投稿を自動で隠します。
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => runAction("/api/fetch", "X投稿取得")}
                disabled={loading}
                className="rounded-full bg-black px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
              >
                X投稿を取得
              </button>
              <button
                onClick={() => runAction("/api/classify", "AI判定")}
                disabled={loading}
                className="rounded-full bg-gray-800 px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
              >
                AI判定する
              </button>
              <button
                onClick={() => {
                  loadPosts().catch((error) =>
                    setMessage(
                      error instanceof Error ? error.message : String(error)
                    )
                  );
                }}
                disabled={loading}
                className="rounded-full border border-gray-300 bg-white px-5 py-3 text-sm font-bold text-gray-800 disabled:opacity-40"
              >
                再読み込み
              </button>
            </div>
          </div>

          {message ? (
            <div className="mt-5 rounded-2xl bg-gray-50 p-4 text-sm leading-6 text-gray-700">
              {message}
            </div>
          ) : null}
        </section>

        <section className="grid gap-4 md:grid-cols-5">
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-gray-500">合計</p>
            <p className="mt-2 text-3xl font-bold">{counts.total}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-emerald-700">表示</p>
            <p className="mt-2 text-3xl font-bold">{counts.show}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-amber-700">マスキング</p>
            <p className="mt-2 text-3xl font-bold">{counts.mask}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-red-700">除外</p>
            <p className="mt-2 text-3xl font-bold">{counts.exclude}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-gray-500">未判定</p>
            <p className="mt-2 text-3xl font-bold">{counts.unclassified}</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="grid gap-6">
            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold">設定を追加</h2>

              <div className="mt-5 grid gap-3">
                <select
                  value={newType}
                  onChange={(event) => setNewType(event.target.value)}
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                >
                  {settingTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>

                <input
                  value={newValue}
                  onChange={(event) => setNewValue(event.target.value)}
                  placeholder="@account または キーワード"
                  className="rounded-2xl border border-gray-200 px-4 py-3 text-sm"
                />

                {newType === "target_keyword" ? (
                  <textarea
                    value={newDescription}
                    onChange={(event) => setNewDescription(event.target.value)}
                    placeholder="キーワードの説明"
                    className="min-h-24 rounded-2xl border border-gray-200 px-4 py-3 text-sm"
                  />
                ) : null}

                <button
                  onClick={addSetting}
                  disabled={loading || !newValue.trim()}
                  className="rounded-full bg-black px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
                >
                  追加する
                </button>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold">現在の設定</h2>

              <div className="mt-5 grid gap-5 text-sm">
                <SettingBlock
                  title="収集対象アカウント"
                  items={settings?.sourceAccounts ?? []}
                  field="handle"
                />
                <SettingBlock
                  title="キーワード"
                  items={settings?.targetKeywords ?? []}
                  field="keyword"
                />
                <SettingBlock
                  title="ミュートワード"
                  items={settings?.muteWords ?? []}
                  field="word"
                />
                <SettingBlock
                  title="ブロック対象"
                  items={settings?.blockAccounts ?? []}
                  field="handle"
                  max={12}
                />
              </div>
            </div>
          </aside>

          <section className="grid gap-4">
            <div className="rounded-3xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap gap-2">
                {filterTabs.map((tab) => {
                  const isActive = activeFilter === tab.value;

                  return (
                    <button
                      key={tab.value}
                      onClick={() => setActiveFilter(tab.value)}
                      className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                        isActive
                          ? "bg-black text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {tab.label}
                      <span className={`ml-2 ${isActive ? "text-white/70" : "text-gray-400"}`}>
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {posts.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
                まだ投稿がありません。「X投稿を取得」を押してください。
              </div>
            ) : null}

            {posts.length > 0 && filteredPosts.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
                この条件に当てはまる投稿はありません。
              </div>
            ) : null}

            {filteredPosts.map((post) => {
              const classification = post.post_classifications?.[0];
              const isMasked =
                classification?.classification === "mask" ||
                classification?.classification === "exclude";
              const canShowText = !isMasked || showMaskedText[post.id];

              return (
                <article
                  key={post.id}
                  className="rounded-3xl bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold">
                          {post.author_name ?? post.author_handle}
                        </p>
                        <p className="text-sm text-gray-500">
                          {post.author_handle}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        {post.posted_at
                          ? new Date(post.posted_at).toLocaleString("ja-JP")
                          : "日時不明"}{" "}
                        /{" "}
                        {post.source_type === "source_account"
                          ? "指定アカウント"
                          : "キーワード検索"}
                        {post.source_label ? `: ${post.source_label}` : ""}
                      </p>
                    </div>

                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-bold ${getStatusClass(
                        classification
                      )}`}
                    >
                      {getStatusLabel(classification)}
                    </span>
                  </div>

                  <div className="mt-5 rounded-2xl bg-gray-50 p-5">
                    {canShowText ? (
                      <div className="grid gap-5">
                        <p className="whitespace-pre-wrap text-sm leading-7">
                          {post.text}
                        </p>

                        {post.media && post.media.length > 0 ? (
                          <div className="grid gap-4">
                            {post.media.map((media) => (
                              <div
                                key={media.media_key}
                                className="overflow-hidden rounded-3xl border border-gray-200 bg-black"
                              >
                                {media.type === "photo" && media.url ? (
                                  <img
                                    src={media.url}
                                    alt=""
                                    className="max-h-[720px] w-full object-contain"
                                  />
                                ) : null}

                                {(media.type === "video" ||
                                  media.type === "animated_gif") &&
                                media.video_url ? (
                                  <video
                                    src={media.video_url}
                                    poster={media.preview_image_url ?? undefined}
                                    controls
                                    playsInline
                                    className="max-h-[720px] w-full bg-black object-contain"
                                  />
                                ) : null}

                                {(media.type === "video" ||
                                  media.type === "animated_gif") &&
                                !media.video_url &&
                                media.preview_image_url ? (
                                  <img
                                    src={media.preview_image_url}
                                    alt=""
                                    className="max-h-[720px] w-full object-contain"
                                  />
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        <p className="text-sm font-bold text-gray-700">
                          この投稿は自動マスキングされています
                        </p>
                        <p className="text-sm leading-6 text-gray-500">
                          {classification?.reason ?? "マスキング対象です"}
                        </p>
                        <button
                          onClick={() =>
                            setShowMaskedText((current) => ({
                              ...current,
                              [post.id]: true,
                            }))
                          }
                          className="w-fit rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-bold"
                        >
                          内容を表示する
                        </button>
                      </div>
                    )}
                  </div>

                  {classification ? (
                    <div className="mt-4 grid gap-2 text-xs leading-5 text-gray-500">
                      <p>
                        <span className="font-bold text-gray-700">判定理由：</span>
                        {classification.reason || "なし"}
                      </p>
                      <p>
                        <span className="font-bold text-gray-700">主な対象：</span>
                        {classification.main_subject || "不明"}
                      </p>
                      <p>
                        <span className="font-bold text-gray-700">感情：</span>
                        {classification.sentiment || "不明"}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-gray-400">
                      まだAI判定されていません。
                    </p>
                  )}

                  <div className="mt-5 border-t border-gray-100 pt-4">
                    <p className="mb-3 text-xs font-bold text-gray-500">
                      この判定へのフィードバック
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => sendFeedback(post.id, "should_show")}
                        disabled={loading}
                        className="rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                      >
                        これは見たい
                      </button>
                      <button
                        onClick={() => sendFeedback(post.id, "should_mask")}
                        disabled={loading}
                        className="rounded-full bg-amber-50 px-4 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-40"
                      >
                        これは隠したい
                      </button>
                      <button
                        onClick={() => sendFeedback(post.id, "should_exclude")}
                        disabled={loading}
                        className="rounded-full bg-red-50 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-40"
                      >
                        これは除外でいい
                      </button>
                      <button
                        onClick={() => sendFeedback(post.id, "wrong_context")}
                        disabled={loading}
                        className="rounded-full bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-40"
                      >
                        文脈違い
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        </section>
      </div>
    </main>
  );
}

function SettingBlock({
  title,
  items,
  field,
  max = 20,
}: {
  title: string;
  items: SettingItem[];
  field: "handle" | "word" | "keyword";
  max?: number;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="font-bold">{title}</h3>
        <span className="text-xs text-gray-400">{items.length}件</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {items.slice(0, max).map((item) => (
          <span
            key={item.id}
            className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
          >
            {String(item[field] ?? "")}
          </span>
        ))}
        {items.length > max ? (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-400">
            +{items.length - max}
          </span>
        ) : null}
      </div>
    </div>
  );
}
