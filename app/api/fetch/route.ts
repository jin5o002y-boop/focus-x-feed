import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type XUser = {
  id: string;
  name?: string;
  username: string;
  description?: string;
};

type XMedia = {
  media_key: string;
  type: "photo" | "video" | "animated_gif";
  url?: string;
  preview_image_url?: string;
  variants?: {
    bit_rate?: number;
    content_type?: string;
    url: string;
  }[];
  width?: number;
  height?: number;
};

type XPost = {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  attachments?: {
    media_keys?: string[];
  };
};

type XApiResponse = {
  data?: XPost[];
  includes?: {
    users?: XUser[];
    media?: XMedia[];
  };
  errors?: unknown[];
};

const X_API_BASE = "https://api.x.com/2";

function getBearerToken() {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    throw new Error("X_BEARER_TOKEN is missing");
  }
  return token;
}

function normalizeHandle(handle: string) {
  return handle.replace(/^@/, "").trim();
}

function buildHeaders() {
  return {
    Authorization: `Bearer ${getBearerToken()}`,
  };
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: buildHeaders(),
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`X API error ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

async function getUserByUsername(username: string): Promise<XUser | null> {
  const params = new URLSearchParams({
    "user.fields": "description",
  });

  const url = `${X_API_BASE}/users/by/username/${encodeURIComponent(
    username
  )}?${params.toString()}`;

  const json = await fetchJson(url);

  if (!json.data) {
    return null;
  }

  return json.data as XUser;
}

async function getUserTweets(user: XUser): Promise<XApiResponse> {
  const params = new URLSearchParams({
    max_results: "10",
    exclude: "retweets,replies",
    "tweet.fields": "created_at,author_id,attachments",
    "user.fields": "username,name,description",
    "media.fields": "media_key,type,url,preview_image_url,variants,width,height",
    expansions: "author_id,attachments.media_keys",
  });

  const url = `${X_API_BASE}/users/${user.id}/tweets?${params.toString()}`;
  return fetchJson(url) as Promise<XApiResponse>;
}

async function searchRecentTweets(query: string): Promise<XApiResponse> {
  const params = new URLSearchParams({
    query,
    max_results: "20",
    "tweet.fields": "created_at,author_id,attachments",
    "user.fields": "username,name,description",
    "media.fields": "media_key,type,url,preview_image_url,variants,width,height",
    expansions: "author_id,attachments.media_keys",
  });

  const url = `${X_API_BASE}/tweets/search/recent?${params.toString()}`;
  return fetchJson(url) as Promise<XApiResponse>;
}

function getPostMedia(post: XPost, mediaList: XMedia[]) {
  const keys = post.attachments?.media_keys ?? [];
  const mediaMap = new Map(mediaList.map((media) => [media.media_key, media]));

  return keys
    .map((key) => mediaMap.get(key))
    .filter(Boolean)
    .map((media) => {
      if (!media) return null;

      const bestVideoVariant =
        media.variants
          ?.filter((variant) => variant.content_type === "video/mp4")
          .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0] ?? null;

      return {
        media_key: media.media_key,
        type: media.type,
        url: media.url ?? null,
        preview_image_url: media.preview_image_url ?? null,
        video_url: bestVideoVariant?.url ?? null,
        width: media.width ?? null,
        height: media.height ?? null,
      };
    })
    .filter(Boolean);
}

async function upsertPosts(
  posts: XPost[],
  users: XUser[],
  mediaList: XMedia[],
  sourceType: "source_account" | "keyword_search",
  sourceLabel: string
) {
  const userMap = new Map(users.map((user) => [user.id, user]));
  let saved = 0;

  for (const post of posts) {
    const user = post.author_id ? userMap.get(post.author_id) : undefined;
    const authorHandle = user?.username ? `@${user.username}` : "@unknown";
    const media = getPostMedia(post, mediaList);

    const { error } = await supabaseAdmin.from("x_posts").upsert(
      {
        x_post_id: post.id,
        author_id: post.author_id ?? null,
        author_handle: authorHandle,
        author_name: user?.name ?? null,
        author_profile: user?.description ?? null,
        text: post.text,
        posted_at: post.created_at ?? null,
        source_type: sourceType,
        source_label: sourceLabel,
        media,
        raw: {
          post,
          user,
          media,
        },
      },
      {
        onConflict: "x_post_id",
      }
    );

    if (!error) {
      saved += 1;
    }
  }

  return saved;
}

export async function POST() {
  try {
    const [
      sourceAccountsResult,
      blockAccountsResult,
      muteWordsResult,
      targetKeywordsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("x_source_accounts")
        .select("*")
        .eq("is_active", true),
      supabaseAdmin
        .from("x_block_accounts")
        .select("*")
        .eq("is_active", true),
      supabaseAdmin
        .from("mute_words")
        .select("*")
        .eq("is_active", true),
      supabaseAdmin
        .from("target_keywords")
        .select("*")
        .eq("is_active", true),
    ]);

    if (sourceAccountsResult.error) {
      throw new Error(sourceAccountsResult.error.message);
    }
    if (blockAccountsResult.error) {
      throw new Error(blockAccountsResult.error.message);
    }
    if (muteWordsResult.error) {
      throw new Error(muteWordsResult.error.message);
    }
    if (targetKeywordsResult.error) {
      throw new Error(targetKeywordsResult.error.message);
    }

    const sourceAccounts = sourceAccountsResult.data ?? [];
    const blockHandles = new Set(
      (blockAccountsResult.data ?? []).map((item) =>
        item.handle.toLowerCase()
      )
    );
    const muteWords = (muteWordsResult.data ?? []).map((item) =>
      item.word.toLowerCase()
    );
    const targetKeywords = targetKeywordsResult.data ?? [];

    let savedFromAccounts = 0;
    let savedFromKeywords = 0;
    const errors: string[] = [];

    for (const account of sourceAccounts) {
      try {
        const username = normalizeHandle(account.handle);
        const user = await getUserByUsername(username);

        if (!user) continue;

        await supabaseAdmin
          .from("x_source_accounts")
          .update({
            x_user_id: user.id,
            display_name: user.name ?? null,
            last_fetched_at: new Date().toISOString(),
          })
          .eq("handle", account.handle);

        const result = await getUserTweets(user);
        const posts = result.data ?? [];
        const users = result.includes?.users ?? [user];
        const mediaList = result.includes?.media ?? [];

        const filteredPosts = posts.filter((post) => {
          const text = post.text.toLowerCase();
          const handle = `@${user.username}`.toLowerCase();

          if (blockHandles.has(handle)) return false;
          if (muteWords.some((word) => text.includes(word))) return false;

          return true;
        });

        savedFromAccounts += await upsertPosts(
          filteredPosts,
          users,
          mediaList,
          "source_account",
          account.handle
        );
      } catch (error) {
        errors.push(
          `${account.handle}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    for (const keyword of targetKeywords) {
      try {
        const searchQuery = `("${keyword.keyword}") lang:ja -is:retweet`;

        const result = await searchRecentTweets(searchQuery);
        const posts = result.data ?? [];
        const users = result.includes?.users ?? [];
        const mediaList = result.includes?.media ?? [];

        const filteredPosts = posts.filter((post) => {
          const user = post.author_id
            ? users.find((item) => item.id === post.author_id)
            : undefined;

          const handle = user?.username
            ? `@${user.username}`.toLowerCase()
            : "";

          const text = post.text.toLowerCase();

          if (handle && blockHandles.has(handle)) return false;
          if (muteWords.some((word) => text.includes(word))) return false;

          return true;
        });

        savedFromKeywords += await upsertPosts(
          filteredPosts,
          users,
          mediaList,
          "keyword_search",
          keyword.keyword
        );
      } catch (error) {
        errors.push(
          `${keyword.keyword}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return NextResponse.json({
      ok: true,
      savedFromAccounts,
      savedFromKeywords,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
