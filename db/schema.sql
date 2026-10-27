-- =========================================================
-- LrcShare public schema export
-- Generated at: 2026-10-27 12:59:12.103514+00
-- =========================================================

SET check_function_bodies = false;

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_graphql;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgjwt;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Sequences
CREATE SEQUENCE album_contributors_id_seq;
CREATE SEQUENCE song_contributors_id_seq;
CREATE SEQUENCE song_lyric_doubts_id_seq;

-- Tables
CREATE TABLE album_contributors (
  id bigint NOT NULL,
  album_id text NOT NULL,
  artist_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE albums (
  id text NOT NULL,
  name text NOT NULL,
  year integer,
  cover text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  initial text,
  description text,
  cover_backup text,
  PRIMARY KEY (id)
);

CREATE TABLE api_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE articles (
  id text NOT NULL,
  title text NOT NULL,
  slug text NOT NULL,
  summary text DEFAULT ''::text,
  content text DEFAULT ''::text NOT NULL,
  cover text DEFAULT ''::text,
  author text DEFAULT '站长'::text,
  status text DEFAULT 'published'::text NOT NULL,
  sort integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  cover_backup text,
  PRIMARY KEY (id)
);

CREATE TABLE artists (
  id text NOT NULL,
  name text NOT NULL,
  avatar text DEFAULT ''::text,
  bio text DEFAULT ''::text,
  aliases text[] DEFAULT '{}'::text[],
  types text[] DEFAULT '{singer}'::text[],
  disambiguation text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  sort integer DEFAULT 0,
  is_show boolean DEFAULT true,
  bg_image text DEFAULT ''::text,
  bg_position_y integer DEFAULT 50,
  urls jsonb DEFAULT '{}'::jsonb,
  initial text,
  avatar_backup text,
  bg_image_backup text,
  PRIMARY KEY (id)
);

CREATE TABLE contributors (
  id text NOT NULL,
  name text NOT NULL,
  avatar text DEFAULT ''::text,
  bio text DEFAULT ''::text,
  contact_value jsonb DEFAULT '{}'::jsonb,
  location text DEFAULT ''::text,
  tags text[] DEFAULT '{}'::text[],
  is_owner boolean DEFAULT false,
  sort integer DEFAULT 0,
  public_contact boolean DEFAULT false,
  public_bio boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  avatar_backup text,
  PRIMARY KEY (id)
);

CREATE TABLE friend_categories (
  id text NOT NULL,
  name text NOT NULL,
  color text DEFAULT '#3b82f6'::text,
  icon text DEFAULT ''::text,
  sort integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE friends (
  id text NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  avatar text DEFAULT ''::text,
  descr text DEFAULT ''::text,
  category_id text,
  sort integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  extra_links jsonb,
  avatar_backup text,
  PRIMARY KEY (id)
);

CREATE TABLE lyric_versions (
  id text NOT NULL,
  song_id text NOT NULL,
  format text NOT NULL,
  source text DEFAULT 'user'::text NOT NULL,
  external_id text,
  content_hash text,
  ttml_text text,
  langs text[] DEFAULT '{}'::text[] NOT NULL,
  status text DEFAULT 'published'::text NOT NULL,
  is_primary boolean DEFAULT false NOT NULL,
  contributor_id text,
  source_credit text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  sort_order integer,
  PRIMARY KEY (id)
);

CREATE TABLE mail_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  action text NOT NULL,
  to_email text NOT NULL,
  subject text,
  song_title text,
  user_name text,
  status text DEFAULT 'pending'::text NOT NULL,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE music_shares (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  platform text NOT NULL,
  media_type text NOT NULL,
  platform_id text NOT NULL,
  source_url text NOT NULL,
  title text NOT NULL,
  artist text,
  cover_url text,
  reason text NOT NULL,
  is_own_work boolean DEFAULT false NOT NULL,
  contributor_id text,
  submitter_name text NOT NULL,
  submitter_contact jsonb DEFAULT '{}'::jsonb NOT NULL,
  user_email text,
  sort integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  reject_reason text,
  reviewed_at timestamp with time zone,
  approved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  norm_title text GENERATED ALWAYS AS (lower(btrim(title))) STORED,
  norm_artist text GENERATED ALWAYS AS (lower(btrim(artist))) STORED,
  tracks jsonb,
  pinned_until timestamp with time zone,
  submitter_public_contact boolean DEFAULT false NOT NULL,
  submitter_request_update boolean DEFAULT false NOT NULL,
  submitter_request_clear boolean DEFAULT false NOT NULL,
  submitter_bio text,
  cover_url_backup text,
  PRIMARY KEY (id)
);

CREATE TABLE settings (
  key text NOT NULL,
  value text DEFAULT ''::text NOT NULL,
  PRIMARY KEY (key)
);

CREATE TABLE song_contributors (
  id bigint NOT NULL,
  song_id text NOT NULL,
  artist_id text NOT NULL,
  role text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE song_lyric_doubts (
  id bigint NOT NULL,
  song_id text NOT NULL,
  line_no integer,
  raw_text text NOT NULL,
  reason text NOT NULL,
  resolved boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_lang text,
  resolved_kind text,
  PRIMARY KEY (id)
);

CREATE TABLE song_lyric_lines (
  song_id text NOT NULL,
  lang text NOT NULL,
  kind text NOT NULL,
  seq integer NOT NULL,
  time_ms integer,
  text text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  end_ms integer,
  version_id text NOT NULL,
  PRIMARY KEY (version_id, lang, kind, seq)
);

CREATE TABLE song_secrets (
  song_id text NOT NULL,
  unlock_code text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (song_id)
);

CREATE TABLE songs (
  id text NOT NULL,
  title text NOT NULL,
  album_id text,
  duration text DEFAULT ''::text,
  lrc_text text DEFAULT ''::text,
  status text DEFAULT 'published'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  track integer DEFAULT 0,
  contributor_id text,
  lyrics_text text,
  video_url text,
  description text,
  is_hidden boolean DEFAULT false,
  genres text[],
  disc integer DEFAULT 1,
  cover text,
  aliases text[] DEFAULT '{}'::text[] NOT NULL,
  search_text text,
  source_ids jsonb DEFAULT '{}'::jsonb NOT NULL,
  origin text DEFAULT 'user'::text NOT NULL,
  cover_backup text,
  PRIMARY KEY (id)
);

CREATE TABLE sponsors (
  id text NOT NULL,
  name text NOT NULL,
  amount numeric(10,2) DEFAULT 0 NOT NULL,
  datatime date DEFAULT CURRENT_DATE NOT NULL,
  suffix text DEFAULT '元'::text,
  descr text DEFAULT ''::text,
  title text DEFAULT ''::text,
  url text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE submissions (
  id text NOT NULL,
  user_name text DEFAULT '匿名'::text NOT NULL,
  song_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  reject_reason text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  approved_at timestamp with time zone,
  rejected_at timestamp with time zone,
  contributor_id text,
  submitter_public_contact boolean DEFAULT false,
  submitter_request_update boolean DEFAULT false,
  submitter_request_clear boolean DEFAULT false,
  contact_value jsonb DEFAULT '{}'::jsonb,
  submitter_bio text,
  batch_id text,
  batch_size integer,
  published_refs jsonb,
  PRIMARY KEY (id)
);

CREATE TABLE ttml_hub_pending (
  id text NOT NULL,
  title text NOT NULL,
  artists text[] DEFAULT '{}'::text[] NOT NULL,
  album text,
  source_ids jsonb DEFAULT '{}'::jsonb NOT NULL,
  path text NOT NULL,
  sha256 text,
  reason text NOT NULL,
  candidates jsonb,
  resolution text,
  resolved_song text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  PRIMARY KEY (id)
);

CREATE TABLE ttml_hub_state (
  id text DEFAULT 'singleton'::text NOT NULL,
  revision text,
  etag text,
  last_check timestamp with time zone,
  last_sync timestamp with time zone,
  snapshot jsonb,
  PRIMARY KEY (id)
);

-- Constraints (FK / Unique / Check)
ALTER TABLE album_contributors ADD CONSTRAINT album_contributors_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE;
ALTER TABLE album_contributors ADD CONSTRAINT album_contributors_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE RESTRICT;
ALTER TABLE album_contributors ADD CONSTRAINT album_contributors_album_artist_key UNIQUE (album_id, artist_id);
ALTER TABLE api_keys ADD CONSTRAINT api_keys_key_hash_len_chk CHECK ((char_length(key_hash) = 64));
ALTER TABLE api_keys ADD CONSTRAINT api_keys_key_prefix_len_chk CHECK ((char_length(key_prefix) = 8));
ALTER TABLE api_keys ADD CONSTRAINT api_keys_status_check CHECK ((status = ANY (ARRAY['active'::text, 'banned'::text])));
ALTER TABLE articles ADD CONSTRAINT articles_status_chk CHECK ((status = ANY (ARRAY['published'::text, 'draft'::text])));
ALTER TABLE articles ADD CONSTRAINT articles_slug_key UNIQUE (slug);
ALTER TABLE friend_categories ADD CONSTRAINT friend_categories_name_key UNIQUE (name);
ALTER TABLE friends ADD CONSTRAINT friends_extra_links_chk CHECK (((extra_links IS NULL) OR (jsonb_typeof(extra_links) = 'array'::text)));
ALTER TABLE friends ADD CONSTRAINT friends_category_id_fkey FOREIGN KEY (category_id) REFERENCES friend_categories(id) ON DELETE SET NULL;
ALTER TABLE lyric_versions ADD CONSTRAINT lyric_versions_check CHECK (((format = 'ttml'::text) OR (ttml_text IS NULL)));
ALTER TABLE lyric_versions ADD CONSTRAINT lyric_versions_check1 CHECK (((format <> 'ttml'::text) OR (ttml_text IS NOT NULL)));
ALTER TABLE lyric_versions ADD CONSTRAINT lyric_versions_check2 CHECK (((source <> 'ttml-hub'::text) OR (external_id IS NOT NULL)));
ALTER TABLE lyric_versions ADD CONSTRAINT lyric_versions_format_check CHECK ((format = ANY (ARRAY['lrc'::text, 'enhanced'::text, 'ttml'::text])));
ALTER TABLE lyric_versions ADD CONSTRAINT lyric_versions_source_check CHECK ((source = ANY (ARRAY['user'::text, 'ttml-hub'::text])));
ALTER TABLE lyric_versions ADD CONSTRAINT lyric_versions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'published'::text, 'rejected'::text, 'withdrawn'::text])));
ALTER TABLE lyric_versions ADD CONSTRAINT lyric_versions_contributor_id_fkey FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE SET NULL;
ALTER TABLE lyric_versions ADD CONSTRAINT lyric_versions_song_id_fkey FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE;
ALTER TABLE music_shares ADD CONSTRAINT music_shares_approved_owner_chk CHECK (((status <> 'approved'::text) OR (contributor_id IS NOT NULL)));
ALTER TABLE music_shares ADD CONSTRAINT music_shares_media_type_chk CHECK ((media_type = ANY (ARRAY['song'::text, 'album'::text])));
ALTER TABLE music_shares ADD CONSTRAINT music_shares_platform_chk CHECK ((platform = ANY (ARRAY['netease'::text, 'youtube'::text, 'soundcloud'::text])));
ALTER TABLE music_shares ADD CONSTRAINT music_shares_reason_len_chk CHECK (((char_length(btrim(reason)) >= 1) AND (char_length(btrim(reason)) <= 200)));
ALTER TABLE music_shares ADD CONSTRAINT music_shares_sort_chk CHECK ((sort >= 0));
ALTER TABLE music_shares ADD CONSTRAINT music_shares_source_url_chk CHECK ((source_url ~ '^https://'::text));
ALTER TABLE music_shares ADD CONSTRAINT music_shares_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE music_shares ADD CONSTRAINT music_shares_contributor_id_fkey FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE SET NULL;
ALTER TABLE song_contributors ADD CONSTRAINT song_contributors_role_check CHECK ((role = ANY (ARRAY['singer'::text, 'lyricist'::text, 'composer'::text, 'arranger'::text])));
ALTER TABLE song_contributors ADD CONSTRAINT song_contributors_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE RESTRICT;
ALTER TABLE song_contributors ADD CONSTRAINT song_contributors_song_id_fkey FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE;
ALTER TABLE song_contributors ADD CONSTRAINT song_contributors_song_artist_role_key UNIQUE (song_id, artist_id, role);
ALTER TABLE song_lyric_doubts ADD CONSTRAINT song_lyric_doubts_reason_check CHECK ((reason = ANY (ARRAY['multi_same_ts'::text, 'bare_line'::text, 'word_tag_ambiguous'::text])));
ALTER TABLE song_lyric_doubts ADD CONSTRAINT song_lyric_doubts_song_id_fkey FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE;
ALTER TABLE song_lyric_lines ADD CONSTRAINT song_lyric_lines_end_ms_check CHECK (((end_ms IS NULL) OR (end_ms >= 0)));
ALTER TABLE song_lyric_lines ADD CONSTRAINT song_lyric_lines_kind_check CHECK ((kind = ANY (ARRAY['original'::text, 'translation'::text, 'romanization'::text])));
ALTER TABLE song_lyric_lines ADD CONSTRAINT song_lyric_lines_lang_check CHECK ((lang <> ''::text));
ALTER TABLE song_lyric_lines ADD CONSTRAINT song_lyric_lines_seq_check CHECK ((seq >= 1));
ALTER TABLE song_lyric_lines ADD CONSTRAINT song_lyric_lines_time_ms_check CHECK (((time_ms IS NULL) OR (time_ms >= 0)));
ALTER TABLE song_lyric_lines ADD CONSTRAINT sll_version_fkey FOREIGN KEY (version_id) REFERENCES lyric_versions(id) ON DELETE CASCADE;
ALTER TABLE song_lyric_lines ADD CONSTRAINT song_lyric_lines_song_id_fkey FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE;
ALTER TABLE song_secrets ADD CONSTRAINT song_secrets_song_id_fkey FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE;
ALTER TABLE songs ADD CONSTRAINT songs_origin_check CHECK ((origin = ANY (ARRAY['user'::text, 'ttml-hub'::text])));
ALTER TABLE songs ADD CONSTRAINT songs_status_chk CHECK ((status = ANY (ARRAY['published'::text, 'draft'::text])));
ALTER TABLE songs ADD CONSTRAINT songs_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE SET NULL;
ALTER TABLE songs ADD CONSTRAINT songs_contributor_id_fkey FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE SET NULL;
ALTER TABLE submissions ADD CONSTRAINT submissions_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text])));
ALTER TABLE submissions ADD CONSTRAINT submissions_contributor_id_fkey FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE SET NULL;
ALTER TABLE ttml_hub_pending ADD CONSTRAINT ttml_hub_pending_reason_check CHECK ((reason = ANY (ARRAY['multi_candidate'::text, 'low_confidence'::text, 'conflict'::text])));
ALTER TABLE ttml_hub_pending ADD CONSTRAINT ttml_hub_pending_resolution_check CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['merged'::text, 'created'::text, 'ignored'::text]))));

-- Indexes
CREATE INDEX idx_album_contributors_artist ON public.album_contributors USING btree (artist_id);
CREATE INDEX idx_albums_name ON public.albums USING btree (name);
CREATE INDEX idx_articles_created ON public.articles USING btree (created_at DESC);
CREATE INDEX idx_articles_slug ON public.articles USING btree (slug);
CREATE INDEX idx_articles_sort ON public.articles USING btree (sort, created_at DESC);
CREATE INDEX idx_articles_status ON public.articles USING btree (status);
CREATE INDEX idx_artists_name ON public.artists USING btree (name);
CREATE INDEX idx_contributors_name ON public.contributors USING btree (name);
CREATE INDEX idx_contributors_owner ON public.contributors USING btree (is_owner DESC);
CREATE INDEX idx_friend_categories_sort ON public.friend_categories USING btree (sort);
CREATE INDEX idx_friends_category ON public.friends USING btree (category_id);
CREATE INDEX idx_friends_sort ON public.friends USING btree (sort);
CREATE INDEX lyric_versions_song_idx ON public.lyric_versions USING btree (song_id);
CREATE INDEX lyric_versions_song_sort_idx ON public.lyric_versions USING btree (song_id, sort_order);
CREATE INDEX mail_logs_created_at_idx ON public.mail_logs USING btree (created_at DESC);
CREATE INDEX idx_music_shares_page_sort ON public.music_shares USING btree (((sort = 0)), sort, approved_at DESC) WHERE (status = 'approved'::text);
CREATE INDEX idx_music_shares_pinned_until ON public.music_shares USING btree (created_at DESC) WHERE ((status = 'approved'::text) AND (pinned_until IS NOT NULL));
CREATE INDEX idx_music_shares_status_created ON public.music_shares USING btree (status, created_at DESC);
CREATE INDEX idx_song_contributors_artist ON public.song_contributors USING btree (artist_id, role);
CREATE INDEX idx_song_contributors_song ON public.song_contributors USING btree (song_id);
CREATE INDEX idx_lyric_doubts_open ON public.song_lyric_doubts USING btree (resolved, created_at);
CREATE INDEX idx_lyric_doubts_song ON public.song_lyric_doubts USING btree (song_id);
CREATE INDEX sll_song_idx ON public.song_lyric_lines USING btree (song_id);
CREATE INDEX idx_songs_album_id ON public.songs USING btree (album_id);
CREATE INDEX idx_songs_is_hidden ON public.songs USING btree (is_hidden);
CREATE INDEX idx_songs_search_text_trgm ON public.songs USING gin (lower(search_text) gin_trgm_ops);
CREATE INDEX idx_songs_status ON public.songs USING btree (status);
CREATE INDEX idx_songs_title ON public.songs USING gin (to_tsvector('simple'::regconfig, title));
CREATE INDEX songs_source_ids_gin ON public.songs USING gin (source_ids);
CREATE INDEX idx_sponsors_amount ON public.sponsors USING btree (amount DESC);
CREATE INDEX idx_sponsors_datatime ON public.sponsors USING btree (datatime DESC);
CREATE INDEX idx_submissions_batch_id ON public.submissions USING btree (batch_id) WHERE (batch_id IS NOT NULL);
CREATE INDEX idx_submissions_status ON public.submissions USING btree (status);
CREATE INDEX ttml_hub_pending_open_idx ON public.ttml_hub_pending USING btree (created_at) WHERE (resolution IS NULL);

-- Comments
COMMENT ON TABLE albums IS '专辑表：存储音乐专辑信息';
COMMENT ON TABLE articles IS '文章表：站长逼逼/教程/喜报/公告';
COMMENT ON TABLE artists IS '艺术家表：存储歌手、作词人、作曲人、编曲人信息';
COMMENT ON TABLE contributors IS '贡献者表：存储歌词提交者、设计师等贡献者信息';
COMMENT ON TABLE friend_categories IS '友链分类表';
COMMENT ON TABLE friends IS '友链表';
COMMENT ON TABLE music_shares IS '歌曲分享：用户投稿的单曲/专辑分享（网易云/YouTube/SoundCloud 三家统一播放器），审核制';
COMMENT ON TABLE settings IS '系统设置表（键值对存储）';
COMMENT ON TABLE songs IS '歌曲表：存储歌曲元数据和LRC歌词';
COMMENT ON TABLE submissions IS '投稿表：用户提交的歌词投稿';
COMMENT ON COLUMN albums.id IS '专辑ID，如 alb_zhoujielun_001';
COMMENT ON COLUMN albums.name IS '专辑名称';
COMMENT ON COLUMN albums.year IS '专辑发行年份';
COMMENT ON COLUMN albums.cover IS '专辑封面URL';
COMMENT ON COLUMN albums.created_at IS '创建时间';
COMMENT ON COLUMN albums.initial IS '人工覆盖的拼音首字母（A-Z 或 #），空则前端自动计算';
COMMENT ON COLUMN albums.description IS '专辑介绍（Markdown/HTML 富文本，前台专辑页展示）';
COMMENT ON COLUMN albums.cover_backup IS '封面阿里云 OSS 备份地址（灾备用；image_source=aliyun 时前台改走此列，空值回退 cover）';
COMMENT ON COLUMN articles.id IS '文章ID，如 art001';
COMMENT ON COLUMN articles.title IS '文章标题';
COMMENT ON COLUMN articles.slug IS 'URL友好标识（唯一）';
COMMENT ON COLUMN articles.summary IS '文章摘要';
COMMENT ON COLUMN articles.content IS '文章正文（HTML格式）';
COMMENT ON COLUMN articles.cover IS '文章封面图URL';
COMMENT ON COLUMN articles.author IS '作者（默认站长）';
COMMENT ON COLUMN articles.status IS '状态：published=已发布，draft=草稿';
COMMENT ON COLUMN articles.sort IS '排序：0=按时间倒序，>0 置顶且越小越靠前';
COMMENT ON COLUMN articles.created_at IS '创建时间';
COMMENT ON COLUMN articles.updated_at IS '更新时间';
COMMENT ON COLUMN articles.cover_backup IS '文章封面阿里云 OSS 备份地址（灾备切换列，空值回退 cover）';
COMMENT ON COLUMN artists.id IS '艺术家ID，如 art_zhoujielun';
COMMENT ON COLUMN artists.name IS '艺术家名称';
COMMENT ON COLUMN artists.avatar IS '艺术家头像URL';
COMMENT ON COLUMN artists.bio IS '艺术家简介';
COMMENT ON COLUMN artists.aliases IS '别名数组，如 {英文名, 曾用名}';
COMMENT ON COLUMN artists.types IS '类型数组：singer/lyricist/composer/arranger';
COMMENT ON COLUMN artists.disambiguation IS '消歧义信息（同名艺术家区分用）';
COMMENT ON COLUMN artists.created_at IS '创建时间';
COMMENT ON COLUMN artists.sort IS '排序权重（0=默认，>0 置顶，越小越靠前）';
COMMENT ON COLUMN artists.is_show IS '是否前端展示（false=隐藏，用于非创作类实体如唱片公司）';
COMMENT ON COLUMN artists.bg_image IS '详情页背景图URL';
COMMENT ON COLUMN artists.bg_position_y IS '背景图垂直位置百分比（0-100）';
COMMENT ON COLUMN artists.urls IS '社交链接（JSONB，key为平台中文名如 {"网易音乐人":"url","微博":"url","B站":"url","Instagram":"url","QQ音乐":"url"}）';
COMMENT ON COLUMN artists.initial IS '人工覆盖的拼音首字母（A-Z 或 #），空则前端自动计算';
COMMENT ON COLUMN artists.avatar_backup IS '头像阿里云 OSS 备份地址（灾备切换列，空值回退 avatar）';
COMMENT ON COLUMN artists.bg_image_backup IS '详情背景图阿里云 OSS 备份地址（灾备切换列，空值回退 bg_image）';
COMMENT ON COLUMN contributors.id IS '贡献者ID，如 ct_owner';
COMMENT ON COLUMN contributors.name IS '贡献者名称/昵称';
COMMENT ON COLUMN contributors.avatar IS '贡献者头像URL';
COMMENT ON COLUMN contributors.bio IS '简介/贡献说明（如：歌词听写、LOGO设计等）';
COMMENT ON COLUMN contributors.contact_value IS '联系方式值（JSONB，如 {"email":"a@b.com","qq":"123"}）';
COMMENT ON COLUMN contributors.location IS '地区';
COMMENT ON COLUMN contributors.tags IS '贡献类型标签数组，如 {歌词提交, LOGO设计}';
COMMENT ON COLUMN contributors.is_owner IS '是否站长（true=站长，前端显示站长标签）';
COMMENT ON COLUMN contributors.sort IS '排序权重（0=默认，越小越靠前）';
COMMENT ON COLUMN contributors.public_contact IS '是否公开联系方式';
COMMENT ON COLUMN contributors.public_bio IS '是否公开简介';
COMMENT ON COLUMN contributors.created_at IS '创建时间';
COMMENT ON COLUMN contributors.avatar_backup IS '头像阿里云 OSS 备份地址（灾备切换列，空值回退 avatar）';
COMMENT ON COLUMN friend_categories.id IS '分类ID，如 cat_tool';
COMMENT ON COLUMN friend_categories.name IS '分类名称（唯一）';
COMMENT ON COLUMN friend_categories.color IS '分类颜色（十六进制，用于前端展示）';
COMMENT ON COLUMN friend_categories.icon IS '分类图标（emoji）';
COMMENT ON COLUMN friend_categories.sort IS '排序权重（越小越靠前）';
COMMENT ON COLUMN friend_categories.created_at IS '创建时间';
COMMENT ON COLUMN friends.id IS '友链ID，如 fr101';
COMMENT ON COLUMN friends.name IS '友链名称';
COMMENT ON COLUMN friends.url IS '友链URL';
COMMENT ON COLUMN friends.avatar IS '友链头像URL';
COMMENT ON COLUMN friends.descr IS '友链描述';
COMMENT ON COLUMN friends.category_id IS '分类ID（外键关联 friend_categories）';
COMMENT ON COLUMN friends.sort IS '排序权重（越小越靠前）';
COMMENT ON COLUMN friends.created_at IS '创建时间';
COMMENT ON COLUMN friends.extra_links IS '附加链接数组：[{label, url}]，label 为平台英文键（与 AppIcon ICON_MAP 对齐）';
COMMENT ON COLUMN friends.avatar_backup IS '友链头像阿里云 OSS 备份地址（灾备切换列，空值回退 avatar）';
COMMENT ON COLUMN music_shares.platform_id IS '平台内容 ID（youtube 为视频 ID/列表 ID，soundcloud 为规范化永久链接，netease 为数字 ID）';
COMMENT ON COLUMN music_shares.reason IS '推荐理由（必填，1~200 字）：首页随机推荐卡展示给听众的推荐语';
COMMENT ON COLUMN music_shares.is_own_work IS '投稿人自荐本人原创作品，仅影响这一条的创作者卡片样式，审核可改';
COMMENT ON COLUMN music_shares.contributor_id IS '审核通过后绑定的贡献者账号（contributors.id，text）';
COMMENT ON COLUMN music_shares.tracks IS '专辑曲目快照 jsonb：[{id,title,artist,duration,cover_url}]，单曲 NULL；播放时展开为队列';
COMMENT ON COLUMN music_shares.pinned_until IS '首页「新歌推荐」置顶截止时间：NULL/已过期=未置顶（回落随机）；>now()=置顶中，多条按投稿时间轮播。仅站长可设，投稿白名单不含此列';
COMMENT ON COLUMN music_shares.submitter_public_contact IS '投稿人勾选的联系方式公开意愿：false=仅站长可见（默认）；true=审核通过新建贡献者时按此写入 contributors.public_contact。绑定已有贡献者不覆盖其设置';
COMMENT ON COLUMN music_shares.submitter_request_update IS '投稿人勾选「更新我的信息」：true=审核通过时用本次提交的邮箱/简介/联系方式/公开意愿全量覆盖该贡献者资料；仅当 contributor_id 指向已有贡献者时有意义';
COMMENT ON COLUMN music_shares.submitter_bio IS '投稿快照：本次提交的简介文本。新建贡献者时写入 contributors.bio；勾选更新时一并覆盖；否则不影响已有资料';
COMMENT ON COLUMN music_shares.cover_url_backup IS '平台封面阿里云 OSS 备份地址（灾备切换列，空值回退 cover_url；匿名投稿不可写此列）';
COMMENT ON COLUMN settings.key IS '设置项键名，如 hidden_unlock_code';
COMMENT ON COLUMN settings.value IS '设置项值';
COMMENT ON COLUMN songs.id IS '歌曲ID，如 s_zhoujielun_001';
COMMENT ON COLUMN songs.title IS '歌曲标题';
COMMENT ON COLUMN songs.album_id IS '所属专辑ID（外键关联 albums）';
COMMENT ON COLUMN songs.duration IS '歌曲时长（格式 mm:ss 或 mm:ss.xxx）';
COMMENT ON COLUMN songs.lrc_text IS 'LRC滚动歌词全文';
COMMENT ON COLUMN songs.status IS '状态：published=已发布，draft=草稿';
COMMENT ON COLUMN songs.created_at IS '创建时间';
COMMENT ON COLUMN songs.track IS '曲目号（专辑内排序号）';
COMMENT ON COLUMN songs.contributor_id IS '贡献者ID（歌词提交者，关联 contributors 表）';
COMMENT ON COLUMN songs.is_hidden IS '是否隐藏（true=需解锁码才能查看）';
COMMENT ON COLUMN songs.genres IS '风格标签数组，如 {Mandopop, Hip-Hop}';
COMMENT ON COLUMN songs.disc IS '碟号（CD编号，默认1，多碟专辑用）';
COMMENT ON COLUMN songs.cover IS '单曲封面（预热单曲等场景；为空时回退专辑封面）';
COMMENT ON COLUMN songs.cover_backup IS '单曲封面阿里云 OSS 备份地址（灾备切换列，空值回退 cover / 专辑封面）';
COMMENT ON COLUMN submissions.id IS '投稿ID';
COMMENT ON COLUMN submissions.user_name IS '投稿者名称（默认匿名）';
COMMENT ON COLUMN submissions.song_data IS '投稿歌曲数据（JSONB，包含歌曲元数据和LRC）';
COMMENT ON COLUMN submissions.status IS '状态：pending=待审核，approved=已通过，rejected=已拒绝';
COMMENT ON COLUMN submissions.reject_reason IS '拒绝原因';
COMMENT ON COLUMN submissions.created_at IS '投稿时间';
COMMENT ON COLUMN submissions.approved_at IS '审核通过时间';
COMMENT ON COLUMN submissions.rejected_at IS '拒绝时间';
COMMENT ON COLUMN submissions.contributor_id IS '贡献者ID（投稿审核通过后绑定）';
COMMENT ON COLUMN submissions.submitter_public_contact IS '是否公开投稿者联系方式';
COMMENT ON COLUMN submissions.submitter_request_update IS '投稿者是否请求更新贡献者信息';
COMMENT ON COLUMN submissions.submitter_request_clear IS '投稿者是否请求清空贡献者信息';
COMMENT ON COLUMN submissions.contact_value IS '联系方式值（JSONB，与contributors表一致，邮箱统一存在 {"邮箱":"a@b.com"} 中）';
COMMENT ON COLUMN submissions.submitter_bio IS '投稿者简介（新建/更新贡献者时使用）';
COMMENT ON COLUMN submissions.batch_id IS '批次 ID（UUID）：同一次批量投稿共用；单曲投稿为 NULL';
COMMENT ON COLUMN submissions.batch_size IS '批次内投稿总数（冗余存于批内每行）';
COMMENT ON COLUMN submissions.published_refs IS '发布产物：{song_id, album_id, artist_ids[], contributor_id}——发布链新建的实体 ID，删除已通过投稿时按引用检查级联回收';

-- Row Level Security
ALTER TABLE album_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE lyric_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_lyric_doubts ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_lyric_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ttml_hub_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE ttml_hub_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "专辑贡献：所有人可读" ON public.album_contributors AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "专辑贡献：管理员可删" ON public.album_contributors AS PERMISSIVE FOR DELETE TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "专辑贡献：管理员可增" ON public.album_contributors AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "专辑贡献：管理员可改" ON public.album_contributors AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "专辑：所有人可读" ON public.albums AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "专辑：管理员可写入" ON public.albums AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "专辑：管理员可删除" ON public.albums AS PERMISSIVE FOR DELETE TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "专辑：管理员可更新" ON public.albums AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY api_keys_delete ON public.api_keys AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY api_keys_insert ON public.api_keys AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY api_keys_select ON public.api_keys AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY api_keys_update ON public.api_keys AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "文章：所有人可读已发布" ON public.articles AS PERMISSIVE FOR SELECT TO public USING ((status = 'published'::text));
CREATE POLICY "文章：管理员可写入" ON public.articles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "文章：管理员可删除" ON public.articles AS PERMISSIVE FOR DELETE TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "文章：管理员可更新" ON public.articles AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "文章：管理员可读全部" ON public.articles AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "艺术家：所有人可读" ON public.artists AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "艺术家：管理员可写入" ON public.artists AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "艺术家：管理员可删除" ON public.artists AS PERMISSIVE FOR DELETE TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "艺术家：管理员可更新" ON public.artists AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "贡献者：所有人可读" ON public.contributors AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "贡献者：管理员可写入" ON public.contributors AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "贡献者：管理员可删除" ON public.contributors AS PERMISSIVE FOR DELETE TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "贡献者：管理员可更新" ON public.contributors AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "友链分类：所有人可读" ON public.friend_categories AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "友链分类：管理员可写入" ON public.friend_categories AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "友链：所有人可读" ON public.friends AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "友链：管理员可写入" ON public.friends AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "友链：管理员可删除" ON public.friends AS PERMISSIVE FOR DELETE TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "友链：管理员可更新" ON public.friends AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "歌词版本：公开可读已发布" ON public.lyric_versions AS PERMISSIVE FOR SELECT TO anon USING ((status = 'published'::text));
CREATE POLICY "歌词版本：管理员全权" ON public.lyric_versions AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY mail_logs_authenticated_select ON public.mail_logs AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY mail_logs_service_role_all ON public.mail_logs AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY music_shares_anon_insert ON public.music_shares AS PERMISSIVE FOR INSERT TO anon WITH CHECK ((status = 'pending'::text));
CREATE POLICY music_shares_anon_select ON public.music_shares AS PERMISSIVE FOR SELECT TO anon USING ((status = 'approved'::text));
CREATE POLICY music_shares_authenticated_all ON public.music_shares AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY music_shares_service_role_all ON public.music_shares AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY settings_anon_read_image_source ON public.settings AS PERMISSIVE FOR SELECT TO anon USING ((key = 'image_source'::text));
CREATE POLICY "设置：所有人可读公开项" ON public.settings AS PERMISSIVE FOR SELECT TO public USING ((key = ANY (ARRAY['site_name'::text, 'admin_email'::text])));
CREATE POLICY "设置：管理员可写入" ON public.settings AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "设置：管理员可更新" ON public.settings AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "设置：管理员可读全部" ON public.settings AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "歌曲贡献：所有人可读" ON public.song_contributors AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "歌曲贡献：管理员可删" ON public.song_contributors AS PERMISSIVE FOR DELETE TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "歌曲贡献：管理员可增" ON public.song_contributors AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "歌曲贡献：管理员可改" ON public.song_contributors AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "存疑：管理员全权" ON public.song_lyric_doubts AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "歌词行：公开可读" ON public.song_lyric_lines AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY "歌词行：管理员全权" ON public.song_lyric_lines AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "口令：管理员可删" ON public.song_secrets AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY "口令：管理员可增" ON public.song_secrets AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "口令：管理员可改" ON public.song_secrets AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "口令：管理员可读" ON public.song_secrets AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "歌曲：所有人可读已发布" ON public.songs AS PERMISSIVE FOR SELECT TO public USING ((status = 'published'::text));
CREATE POLICY "歌曲：管理员可写入" ON public.songs AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "歌曲：管理员可删除" ON public.songs AS PERMISSIVE FOR DELETE TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "歌曲：管理员可更新删除" ON public.songs AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "歌曲：管理员可读全部" ON public.songs AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "赞助：所有人可读" ON public.sponsors AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "赞助：管理员可写入" ON public.sponsors AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "赞助：管理员可删除" ON public.sponsors AS PERMISSIVE FOR DELETE TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "赞助：管理员可更新" ON public.sponsors AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "投稿：任何人可提交" ON public.submissions AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "投稿：管理员可删除" ON public.submissions AS PERMISSIVE FOR DELETE TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "投稿：管理员可更新" ON public.submissions AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "投稿：管理员可查看所有" ON public.submissions AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "待匹配：管理员全权" ON public.ttml_hub_pending AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "同步状态：管理员只读" ON public.ttml_hub_state AS PERMISSIVE FOR SELECT TO authenticated USING (true);

-- Functions
CREATE OR REPLACE FUNCTION public.admin_merge_contributors(p_source text, p_target text, p_profile jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_source_name  text;
  v_target_name  text;
  v_final_name   text;
  v_avatar       text;
  v_bio          text;
  v_public_bio   boolean;
  v_contact      jsonb;
  v_public_contact boolean;
  v_tags         text[];
  v_sort         int;
  v_songs        int;   -- 转移的歌曲行数
  v_versions     int;   -- 转移的歌词版本行数
  v_submissions  int;   -- 转移的投稿行数
  v_music_shares int;   -- 转移的歌曲分享行数（全部状态：pending/approved/rejected）
  v_cnt          int;
  r              record;
begin
  -- ===== 守卫 1：入参合法性 =====
  if p_source is null or btrim(p_source) = ''
     or p_target is null or btrim(p_target) = '' then
    raise exception '源账号与目标账号 id 均不能为空';
  end if;
  if p_source = p_target then
    raise exception '源账号与目标账号不能是同一账号';
  end if;
  if p_profile is null then
    raise exception '资料参数 p_profile 不能为空（需含 8 个字段的最终值）';
  end if;

  -- ===== 守卫 2：两个账号必须都存在 =====
  select name into v_source_name from public.contributors where id = p_source;
  if not found then
    raise exception '源贡献者 % 不存在，中止（整体回滚）', p_source;
  end if;
  select name into v_target_name from public.contributors where id = p_target;
  if not found then
    raise exception '目标贡献者 % 不存在，中止（整体回滚）', p_target;
  end if;

  -- ===== 守卫 3：p_profile 八个键必须齐全且类型正确 =====
  v_final_name := nullif(btrim(p_profile ->> 'name'), '');
  if v_final_name is null then
    raise exception 'p_profile.name 缺失或为空';
  end if;

  if not (p_profile ? 'avatar') or jsonb_typeof(p_profile -> 'avatar') not in ('string', 'null') then
    raise exception 'p_profile.avatar 缺失或类型错误（需文本或 null）';
  end if;
  if not (p_profile ? 'bio') or jsonb_typeof(p_profile -> 'bio') not in ('string', 'null') then
    raise exception 'p_profile.bio 缺失或类型错误（需文本或 null）';
  end if;
  v_avatar := nullif(p_profile ->> 'avatar', '');
  v_bio    := nullif(p_profile ->> 'bio', '');

  if jsonb_typeof(p_profile -> 'public_bio') <> 'boolean' then
    raise exception 'p_profile.public_bio 缺失或类型错误（需布尔）';
  end if;
  if jsonb_typeof(p_profile -> 'public_contact') <> 'boolean' then
    raise exception 'p_profile.public_contact 缺失或类型错误（需布尔）';
  end if;
  v_public_bio     := (p_profile ->> 'public_bio')     = 'true';
  v_public_contact := (p_profile ->> 'public_contact') = 'true';

  if jsonb_typeof(p_profile -> 'contact_value') <> 'object' then
    raise exception 'p_profile.contact_value 缺失或类型错误（需 jsonb 对象，允许 {}）';
  end if;
  v_contact := p_profile -> 'contact_value';

  if jsonb_typeof(p_profile -> 'tags') <> 'array' then
    raise exception 'p_profile.tags 缺失或类型错误（需文本数组，允许 []）';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_profile -> 'tags') t
    where jsonb_typeof(t) <> 'string'
  ) then
    raise exception 'p_profile.tags 含有非文本元素';
  end if;
  v_tags := array(select jsonb_array_elements_text(p_profile -> 'tags'));

  if jsonb_typeof(p_profile -> 'sort') <> 'number' then
    raise exception 'p_profile.sort 缺失或类型错误（需整数）';
  end if;
  v_sort := (p_profile ->> 'sort')::int;

  -- ===== 守卫 4：兜底扫描已知四表之外的外键引用 =====
  -- songs / lyric_versions / submissions / music_shares 四张已知表在下方显式处理
  for r in
    select nsp.nspname as schema_name,
           con.relname as table_name,
           att.attname as col_name
    from pg_constraint c
    join pg_class con on con.oid = c.conrelid
    join pg_class fre on fre.oid = c.confrelid
    join pg_namespace nsp on nsp.oid = con.relnamespace
    join pg_attribute att on att.attrelid = con.oid and att.attnum = c.conkey[1]
    where c.contype = 'f'
      and nsp.nspname = 'public'
      and fre.relname = 'contributors'
      and con.relname not in ('songs', 'lyric_versions', 'submissions', 'music_shares')
  loop
    execute format('select count(*) from %I.%I where %I = %L',
                   r.schema_name, r.table_name, r.col_name, p_source)
      into v_cnt;
    if v_cnt > 0 then
      raise exception 'Schema % 表 % 列 % 尚有 % 行引用源贡献者（已知四表之外），中止回滚',
        r.schema_name, r.table_name, r.col_name, v_cnt;
    end if;
  end loop;

  -- ===== 变更 1：写保留账号资料（is_owner / created_at 不动） =====
  update public.contributors
     set name           = v_final_name,
         avatar         = v_avatar,
         bio            = v_bio,
         public_bio     = v_public_bio,
         contact_value  = v_contact,
         public_contact = v_public_contact,
         tags           = v_tags,
         sort           = v_sort
   where id = p_target;

  -- ===== 变更 2：四张表引用置换 =====
  update public.songs
     set contributor_id = p_target
   where contributor_id = p_source;
  get diagnostics v_songs = row_count;

  update public.lyric_versions
     set contributor_id = p_target
   where contributor_id = p_source;
  get diagnostics v_versions = row_count;

  update public.submissions
     set contributor_id = p_target
   where contributor_id = p_source;
  get diagnostics v_submissions = row_count;

  -- 歌曲分享：全部状态（pending/approved/rejected）整单转给保留账号；
  -- 转走后下方 DELETE 源账号时，级联触发器对该账号删 0 行。
  update public.music_shares
     set contributor_id = p_target
   where contributor_id = p_source;
  get diagnostics v_music_shares = row_count;

  -- ===== 变更 3：删除源账号本人（触发器会顺带清理其残留分享，预期 0 行） =====
  delete from public.contributors where id = p_source;

  return jsonb_build_object(
    'source_id',         p_source,
    'source_name',       v_source_name,
    'target_id',         p_target,
    'target_name_old',   v_target_name,
    'target_name',       v_final_name,
    'songs_moved',       v_songs,
    'versions_moved',    v_versions,
    'submissions_moved', v_submissions,
    'music_shares_moved', v_music_shares
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_search_songs(p_q text)
 RETURNS SETOF songs
 LANGUAGE sql
 STABLE
AS $function$
  select s.*
  from public.songs s
  where nullif(trim(p_q), '') is not null
    and (
      s.title ilike '%' || p_q || '%'
      or exists (
        select 1 from unnest(coalesce(s.aliases, '{}'::text[])) a
        where a ilike '%' || p_q || '%'
      )
      -- 歌手：演唱/词/曲/编 + 专辑艺术家（复用现成的 song_artist_ids 汇总）
      or exists (
        select 1
        from public.artists ar
        where ar.id = any(public.song_artist_ids(s.id))
          and (
            ar.name ilike '%' || p_q || '%'
            or exists (
              select 1 from unnest(coalesce(ar.aliases, '{}'::text[])) al
              where al ilike '%' || p_q || '%'
            )
          )
      )
      -- 专辑：所属专辑的名称（albums 表无 aliases 列，与前台专辑搜索一致）
      or exists (
        select 1
        from public.albums al
        where al.id = s.album_id
          and al.name ilike '%' || p_q || '%'
      )
    )
  order by s.created_at desc
$function$
;

CREATE OR REPLACE FUNCTION public.admin_search_songs_count(p_q text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
AS $function$
  select count(*) from public.admin_search_songs(p_q)
$function$
;

CREATE OR REPLACE FUNCTION public.check_music_share_dup(p_platform text, p_platform_id text, p_title text, p_artist text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm_title  text := lower(btrim(COALESCE(p_title, '')));
  v_norm_artist text := lower(btrim(COALESCE(p_artist, '')));
  v_platform_pending boolean := false;
  v_song_pending     boolean := false;
  v_platform_row public.music_shares%ROWTYPE;
  v_song_row     public.music_shares%ROWTYPE;
  v_platform_contributor text;
  v_song_contributor     text;
BEGIN
  -- 入参基本校验（平台枚举 + ID/标题非空）
  IF p_platform NOT IN ('netease','youtube','soundcloud') THEN
    RAISE EXCEPTION '不支持的平台';
  END IF;
  IF btrim(COALESCE(p_platform_id, '')) = '' OR v_norm_title = '' THEN
    RAISE EXCEPTION '平台 ID 与标题不能为空';
  END IF;

  -- ① 同平台同内容：pending 是否存在（任意人提交的待审都算）
  SELECT EXISTS (
    SELECT 1 FROM public.music_shares m
    WHERE m.status = 'pending'
      AND m.platform = p_platform
      AND m.platform_id = p_platform_id
  ) INTO v_platform_pending;

  -- 同平台同内容：approved 命中行（显式列名，取最小展示字段）
  SELECT m.* INTO v_platform_row
  FROM public.music_shares m
  WHERE m.status = 'approved'
    AND m.platform = p_platform
    AND m.platform_id = p_platform_id
  LIMIT 1;

  -- ② 跨平台同曲：pending（要求歌手非空，规则与唯一索引一致）
  IF v_norm_artist <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.music_shares m
      WHERE m.status = 'pending'
        AND m.norm_title = v_norm_title
        AND m.norm_artist = v_norm_artist
    ) INTO v_song_pending;

    SELECT m.* INTO v_song_row
    FROM public.music_shares m
    WHERE m.status = 'approved'
      AND m.norm_title = v_norm_title
      AND m.norm_artist = v_norm_artist
    LIMIT 1;
  END IF;

  -- 关联账号昵称（显式列名，不取联系方式等隐私列）
  IF v_platform_row.contributor_id IS NOT NULL THEN
    SELECT c.name INTO v_platform_contributor
    FROM public.contributors c
    WHERE c.id = v_platform_row.contributor_id;
  END IF;
  IF v_song_row.contributor_id IS NOT NULL THEN
    SELECT c.name INTO v_song_contributor
    FROM public.contributors c
    WHERE c.id = v_song_row.contributor_id;
  END IF;

  RETURN jsonb_build_object(
    'platform_pending', v_platform_pending,
    'platform_approved',
      CASE WHEN v_platform_row.id IS NULL THEN NULL ELSE
        jsonb_build_object(
          'id', v_platform_row.id,
          'title', v_platform_row.title,
          'contributor_name', COALESCE(v_platform_contributor, v_platform_row.submitter_name)
        )
      END,
    'song_pending', v_song_pending,
    'song_approved',
      CASE WHEN v_song_row.id IS NULL THEN NULL ELSE
        jsonb_build_object(
          'id', v_song_row.id,
          'title', v_song_row.title,
          'artist', v_song_row.artist,
          'platform', v_song_row.platform,
          'contributor_name', COALESCE(v_song_contributor, v_song_row.submitter_name)
        )
      END
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_active_api_key_hashes()
 RETURNS text[]
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(key_hash), ARRAY[]::text[])
  FROM public.api_keys
  WHERE status = 'active';
$function$
;

CREATE OR REPLACE FUNCTION public.get_artist_songs(p_artist_id text)
 RETURNS TABLE(id text, title text, aliases text[], artist_ids text[], album_id text, lyricist text, composer text, arranger text, duration text, track integer, disc integer, status text, is_hidden boolean, description text, genres text[], lrc_text text, lyrics_text text, video_url text, cover text, cover_backup text, contributor_id text, created_at timestamp with time zone, albums jsonb, roles text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select s.id, s.title, s.aliases,
         -- 单源：歌手数组（按关系行 id 保序，即迁移时的原数组顺序）
         coalesce((select array_agg(sc.artist_id order by sc.id)
                   from public.song_contributors sc
                   where sc.song_id = s.id and sc.role = 'singer'), '{}') as artist_ids,
         s.album_id,
         -- 词/曲/编：中间表拼回逗号串（保持旧输出形状，前端兼容）
         coalesce((select string_agg(sc.artist_id, ',')
                   from public.song_contributors sc
                   where sc.song_id = s.id and sc.role = 'lyricist'), '') as lyricist,
         coalesce((select string_agg(sc.artist_id, ',')
                   from public.song_contributors sc
                   where sc.song_id = s.id and sc.role = 'composer'), '') as composer,
         coalesce((select string_agg(sc.artist_id, ',')
                   from public.song_contributors sc
                   where sc.song_id = s.id and sc.role = 'arranger'), '') as arranger,
         s.duration, s.track, s.disc, s.status, s.is_hidden, s.description, s.genres,
         s.lrc_text, s.lyrics_text, s.video_url, s.cover, s.cover_backup, s.contributor_id, s.created_at,
         to_jsonb(al) as albums,
         -- 该艺术家在这首歌担任的角色（单源：中间表）
         coalesce((select array_agg(distinct sc.role)
                   from public.song_contributors sc
                   where sc.song_id = s.id and sc.artist_id = p_artist_id), '{}') as roles
  from public.songs s
  left join public.albums al on al.id = s.album_id
  where s.status = 'published'
    and exists (select 1 from public.song_contributors sc
                where sc.song_id = s.id and sc.artist_id = p_artist_id)
  order by s.created_at desc
$function$
;

CREATE OR REPLACE FUNCTION public.get_top_artists(limit_count integer DEFAULT 6)
 RETURNS TABLE(id text, name text, sort integer, avatar text, avatar_backup text, types text[], disambiguation text, is_show boolean, aliases text[], song_count integer)
 LANGUAGE sql
 STABLE
AS $function$
  with counts as (
    select sc.artist_id, count(*) as cnt
    from public.song_contributors sc
    join public.songs s on s.id = sc.song_id and s.status = 'published'
    group by sc.artist_id
  )
  select
    a.id, a.name, a.sort, a.avatar, a.avatar_backup, a.types, a.disambiguation, a.is_show, a.aliases,
    coalesce(c.cnt, 0) as song_count
  from public.artists a
  left join counts c on c.artist_id = a.id
  where a.is_show is not false
  order by
    case when a.sort > 0 then 0 else 1 end,
    case when a.sort > 0 then a.sort end nulls last,
    coalesce(c.cnt, 0) desc,
    a.name asc
  limit coalesce(limit_count, 6)
$function$
;

CREATE OR REPLACE FUNCTION public.get_top_contributors(limit_count integer DEFAULT 9)
 RETURNS TABLE(id text, name text, avatar text, avatar_backup text, bio text, public_bio boolean, contact_value text, public_contact boolean, is_owner boolean, created_at timestamp with time zone, sort integer, tags text[], song_count integer)
 LANGUAGE sql
 STABLE
AS $function$
  with contributor_counts as (
    select contributor_id, count(*) as cnt
    from songs
    where status = 'published' and contributor_id is not null
    group by contributor_id
  )
  select
    c.id, c.name, c.avatar, c.avatar_backup, c.bio, c.public_bio, c.contact_value,
    c.public_contact, c.is_owner, c.created_at, c.sort, c.tags,
    coalesce(cc.cnt, 0) as song_count
  from contributors c
  left join contributor_counts cc on cc.contributor_id = c.id
  order by
    case when c.sort > 0 then 0 else 1 end,
    case when c.sort > 0 then c.sort end nulls last,
    coalesce(cc.cnt, 0) desc,
    c.created_at asc
  limit limit_count
$function$
;

CREATE OR REPLACE FUNCTION public.legacy_version_id(p_song_id text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT 'lv_' || substr(md5('legacy:' || p_song_id), 1, 12)
$function$
;

CREATE OR REPLACE FUNCTION public.lyric_is_credit(p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT p_text ~ '^(作词|作詞|词|詞|作曲|曲|编曲|編曲|演唱|歌手|混音|混声|制作人|製作人|制作|製作|监制|監製|和声|和聲|吉他|结他|鼓|贝斯|貝斯|贝司|键盘|鍵盤|录音|錄音|母带|母帶|后期|後期|字幕|翻译|翻譯|校对|校對|时间轴|時間軸|歌词|歌詞|LRC|Lyrics?|Composer|Composed|Music|Arranger|Arranged|Mixed|Mixing|Mastering|Mastered|Produced|Producer|Video|VSQ|Song|Art|feat\.?|by)[[:space:]]*[:：]'
$function$
;

CREATE OR REPLACE FUNCTION public.lyric_lang_detect(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_text ~ '[ぁ-んァ-ヶー]' THEN 'ja'
    WHEN p_text ~ '[가-힣]' THEN 'ko'
    WHEN p_text ~ '[\u0E00-\u0E7F]' THEN 'th'
    WHEN p_text ~ '[\u0E80-\u0EFF]' THEN 'lo'
    WHEN p_text ~ '[\u0F00-\u0FFF]' THEN 'bo'
    WHEN p_text ~ '[\u1800-\u18AF]' THEN 'mn'
    WHEN p_text ~ '[\u1000-\u109F]' THEN 'my'
    WHEN p_text ~ '[\u1780-\u17FF]' THEN 'km'
    WHEN p_text ~ '[\u0900-\u097F]' THEN 'hi'
    WHEN p_text ~ '[\u0600-\u06FF]' THEN 'ar'
    WHEN p_text ~ '[\u0590-\u05FF]' THEN 'he'
    WHEN p_text ~ '[\u0370-\u03FF]' THEN 'el'
    WHEN p_text ~ '[\u0400-\u04FF]' THEN 'ru'
    WHEN p_text ~ '[一-龥]' THEN 'zh'
    WHEN p_text ~ '[A-Za-z]' THEN 'latin'
    ELSE 'unknown'
  END
$function$
;

CREATE OR REPLACE FUNCTION public.music_shares_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.normalize_duration(raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v text;
  i int;
  m text[];
  min_part text;
  sec_part text;
begin
  -- 规则 1：null / 空串 / 纯空白 → null（空值口径统一为 null）
  if raw is null or btrim(raw) = '' then
    return null;
  end if;

  v := btrim(raw);

  -- 规则 2：全角数字 ０(FF10)～９(FF19) → 半角（用码位循环替换，避免手写生僻字符）
  for i in 0..9 loop
    v := replace(v, chr(65296 + i), i::text);
  end loop;

  -- 规则 2：Unicode 冒号 → 半角冒号
  --   ：全角冒号 U+FF1A；︰竖排呈现形 U+FE13
  v := replace(v, chr(65306), ':');
  v := replace(v, chr(65043), ':');

  if position(':' in v) > 0 then
    -- 规则 3：有冒号 = 分:秒；小数点起视为毫秒整段丢弃（半角 . / 全角 ．U+FF0E）
    v := regexp_replace(v, '[.' || chr(65294) || '].*$', '');
    -- 此时应为「数字:数字」，秒允许 1~2 位
    m := regexp_match(v, '^([0-9]+):([0-9]{1,2})$');
  else
    -- 规则 4：无冒号有点号 = 分.秒（如 05.37 → 05:37）
    v := replace(v, chr(65294), '.');
    m := regexp_match(v, '^([0-9]+)\.([0-9]{1,2})$');
  end if;

  -- 规则 6：无法解析（纯秒数 / 多段 / 含字母等）不猜测，返回 null
  if m is null then
    return null;
  end if;

  min_part := m[1];
  sec_part := m[2];

  -- 规则 6：秒必须 0–59（不做进位；非法直接 null）
  if sec_part::int > 59 then
    return null;
  end if;

  -- 规则 5：分、秒各补齐两位（分钟原值不截断）
  return lpad(min_part, 2, '0') || ':' || lpad(sec_part, 2, '0');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.performer_hit(p_song_id text, p_txt text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1 from public.artists ar
    where ar.is_show is not false
      and ar.id = any(public.song_performer_ids(p_song_id))
      and (
        public.song_tok_sub(ar.name, p_txt)
        or exists (
          select 1 from unnest(coalesce(ar.aliases, '{}')) al
          where public.song_tok_sub(al, p_txt)
        )
      )
  )
$function$
;

CREATE OR REPLACE FUNCTION public.rebuild_song_lyric_lines(p_song_id text, p_version_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lrc       text;
  v_vid       text;
  v_arr       text[];
  v_i         int;
  v_n         int;
  v_line      text;
  v_text      text;
  v_tmp       text;
  v_m         text[];
  v_t         text[];
  v_ts_ms     int;
  v_abs       int;
  v_off       int;
  v_line_ts   int;
  v_result    text;
  v_cur       text;
  v_word      text;
  v_rest      text;
  v_end_ms    int;
  v_meta_key  text;
  v_meta_rank int;
  v_has_ts    boolean;
  v_orig_lang text;
  v_is_translation boolean;
  v_multi_cnt int;
  v_total_cnt int;
  v_grp       record;
  v_cnt       int := 0;
BEGIN
  SELECT lrc_text INTO v_lrc FROM public.songs WHERE id = p_song_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- 解析目标版本：显式指定 > 该歌 lrc/enhanced 用户主版本 > 现场建 legacy
  v_vid := p_version_id;
  IF v_vid IS NULL THEN
    SELECT id INTO v_vid
    FROM public.lyric_versions
    WHERE song_id = p_song_id
      AND source = 'user' AND format IN ('lrc','enhanced')
    ORDER BY is_primary DESC, created_at
    LIMIT 1;
  END IF;

  IF v_lrc IS NULL OR btrim(v_lrc) = '' THEN
    -- 无 LRC：清该版本行 + song 级存疑（存疑仍为 song 级，多版本细化留 D 阶段）
    IF v_vid IS NOT NULL THEN
      DELETE FROM public.song_lyric_lines WHERE version_id = v_vid;
      UPDATE public.lyric_versions SET langs = '{}' WHERE id = v_vid;
    END IF;
    DELETE FROM public.song_lyric_doubts WHERE song_id = p_song_id;
    RETURN 0;
  END IF;

  -- 版本不存在则建 legacy（确定性 ID，幂等）
  IF v_vid IS NULL THEN
    INSERT INTO public.lyric_versions (id, song_id, format, source, status, is_primary, contributor_id)
    VALUES (public.legacy_version_id(p_song_id), p_song_id,
            CASE WHEN v_lrc ~ '<\d{1,6}>' THEN 'enhanced' ELSE 'lrc' END,
            'user', 'published', true,
            (SELECT contributor_id FROM public.songs WHERE id = p_song_id))
    ON CONFLICT (id) DO NOTHING;
    v_vid := public.legacy_version_id(p_song_id);
  END IF;

  -- 幂等：清该版本旧行 + song 级存疑
  DELETE FROM public.song_lyric_lines WHERE version_id = v_vid;
  DELETE FROM public.song_lyric_doubts WHERE song_id = p_song_id;

  DROP TABLE IF EXISTS pg_temp._parsed;
  CREATE TEMP TABLE _parsed (
    line_no   int,
    time_ms   int,
    end_ms    int,
    text      text,
    meta_key  text,
    meta_rank int,
    lang      text,
    kind      text
  );

  -- ── 第一遍：拆行解析 ──
  v_arr := regexp_split_to_array(v_lrc, E'\r?\n');
  v_n := coalesce(array_length(v_arr, 1), 0);

  FOR v_i IN 1..v_n LOOP
    v_line := btrim(v_arr[v_i]);
    CONTINUE WHEN v_line = '';

    -- ① 元数据行 [key:value]
    v_m := regexp_match(v_line, '^\[([A-Za-z][A-Za-z0-9]*):(.*)\]$');
    IF v_m IS NOT NULL THEN
      v_meta_key := lower(v_m[1]);
      v_meta_rank := CASE v_meta_key
        WHEN 'ti' THEN 1 WHEN 'ar' THEN 2 WHEN 'al' THEN 3 WHEN 'by' THEN 4 ELSE 5 END;
      INSERT INTO _parsed (line_no, time_ms, text, meta_key, meta_rank, lang, kind)
      VALUES (v_i, NULL, v_line, v_meta_key, v_meta_rank, NULL, 'original');
      CONTINUE;
    END IF;

    -- ② 时间戳行 [t] 或 [t1][t2]
    IF v_line ~ '^\[\d{1,3}:\d{2}[.:]\d{2,3}\]' THEN
      v_text := regexp_replace(v_line, '^(\[\d{1,3}:\d{2}[.:]\d{2,3}\])+', '');
      v_has_ts := false;

      -- verbatim（纯方括号逐字）：剥行首连续时间戳后 v_text 仍含 [mm:ss.xx] → N+1 时间戳的逐字格式
      IF v_text ~ '\[\d{1,3}:\d{2}[.:]\d{2,3}\]' THEN
        v_t := regexp_match(v_line, '^\[(\d{1,3}):(\d{2})[.:](\d{2,3})\]');
        v_line_ts := v_t[1]::int * 60000 + v_t[2]::int * 1000
                   + CASE WHEN length(v_t[3]) = 2 THEN v_t[3]::int * 10 ELSE v_t[3]::int END;
        v_result := '';
        v_cur := v_text;
        v_off := 0;
        v_end_ms := NULL;
        LOOP
          v_t := regexp_match(v_cur, '^(.*?)\[(\d{1,3}):(\d{2})[.:](\d{2,3})\](.*)$');
          IF v_t IS NULL THEN
            IF v_cur <> '' THEN
              v_result := v_result || CASE WHEN v_off = 0 THEN v_cur ELSE '<' || v_off || '>' || v_cur END;
            END IF;
            EXIT;
          END IF;
          v_word := v_t[1];
          v_ts_ms := v_t[2]::int * 60000 + v_t[3]::int * 1000
                   + CASE WHEN length(v_t[4]) = 2 THEN v_t[4]::int * 10 ELSE v_t[4]::int END;
          v_rest := v_t[5];
          IF v_word <> '' THEN
            v_result := v_result || CASE WHEN v_off = 0 THEN v_word ELSE '<' || v_off || '>' || v_word END;
          END IF;
          IF v_rest = '' THEN
            v_end_ms := v_ts_ms;
            EXIT;
          END IF;
          v_off := v_ts_ms - v_line_ts;
          v_cur := v_rest;
        END LOOP;
        INSERT INTO _parsed (line_no, time_ms, end_ms, text, meta_key, meta_rank, lang, kind)
        VALUES (v_i, v_line_ts, v_end_ms, v_result, NULL, 0, NULL, NULL);
        CONTINUE;
      END IF;

      FOR v_m IN SELECT m FROM regexp_matches(v_line, '\[(\d{1,3}):(\d{2})[.:](\d{2,3})\]', 'g') AS t(m) LOOP
        v_ts_ms := v_m[1]::int * 60000 + v_m[2]::int * 1000
                 + CASE WHEN length(v_m[3]) = 2 THEN v_m[3]::int * 10 ELSE v_m[3]::int END;
        v_has_ts := true;
        v_tmp := v_text;
        WHILE v_tmp ~ '<\d{1,3}:\d{2}\.\d{2,3}>' LOOP
          v_t := regexp_match(v_tmp, '<(\d{1,3}):(\d{2})\.(\d{2,3})>');
          v_abs := v_t[1]::int * 60000 + v_t[2]::int * 1000
                 + CASE WHEN length(v_t[3]) = 2 THEN v_t[3]::int * 10 ELSE v_t[3]::int END;
          v_off := v_abs - v_ts_ms;
          v_tmp := regexp_replace(v_tmp, '<\d{1,3}:\d{2}\.\d{2,3}>', '<' || v_off || '>');
        END LOOP;
        INSERT INTO _parsed (line_no, time_ms, text, meta_key, meta_rank, lang, kind)
        VALUES (v_i, v_ts_ms, v_tmp, NULL, 0, NULL, NULL);
      END LOOP;
      IF NOT v_has_ts THEN
        INSERT INTO public.song_lyric_doubts (song_id, line_no, raw_text, reason)
        VALUES (p_song_id, v_i, v_line, 'bare_line');
      END IF;
      CONTINUE;
    END IF;

    -- ③ 裸行 → 存疑
    IF btrim(v_line) <> '' THEN
      INSERT INTO public.song_lyric_doubts (song_id, line_no, raw_text, reason)
      VALUES (p_song_id, v_i, v_line, 'bare_line');
    END IF;
  END LOOP;

  -- ── 第二遍：确定 primary_lang ──
  SELECT d.lang INTO v_orig_lang
  FROM (
    SELECT CASE lyric_lang_detect(text)
             WHEN 'latin' THEN 'en'
             WHEN 'unknown' THEN NULL
             ELSE lyric_lang_detect(text)
           END AS lang
    FROM _parsed
    WHERE time_ms IS NOT NULL
  ) d
  WHERE d.lang IS NOT NULL
  GROUP BY d.lang
  ORDER BY count(*) DESC, d.lang
  LIMIT 1;
  IF v_orig_lang IS NULL THEN v_orig_lang := 'und'; END IF;

  -- ── 第三遍前：歌级结构判定（成对占比）──
  SELECT count(*) FILTER (WHERE t.cnt >= 2), count(*)
  INTO v_multi_cnt, v_total_cnt
  FROM (
    SELECT time_ms, count(*) AS cnt
    FROM _parsed
    WHERE time_ms IS NOT NULL
      AND btrim(text) <> ''
      AND lyric_lang_detect(text) <> 'unknown'
      AND NOT lyric_is_credit(text)
    GROUP BY time_ms
  ) t;
  v_is_translation := (coalesce(v_total_cnt, 0) > 0
    AND coalesce(v_multi_cnt, 0) >= 0.5 * coalesce(v_total_cnt, 0));

  -- ── 第三遍：同戳组拆分 ──
  FOR v_grp IN
    SELECT time_ms AS ts
    FROM _parsed WHERE time_ms IS NOT NULL
    GROUP BY time_ms
    HAVING count(*) FILTER (WHERE btrim(text) <> '' AND lyric_lang_detect(text) <> 'unknown') > 1
    ORDER BY time_ms
  LOOP
    IF NOT v_is_translation THEN
      UPDATE _parsed SET lang = v_orig_lang, kind = 'original' WHERE time_ms = v_grp.ts;
    ELSE
      UPDATE _parsed p
      SET lang = CASE sub.det
                   WHEN 'unknown' THEN v_orig_lang
                   WHEN 'latin' THEN 'en'
                   ELSE sub.det
                 END,
          kind = CASE WHEN sub.pos = 1 THEN 'original' ELSE 'translation' END
      FROM (
        SELECT line_no,
               row_number() OVER (ORDER BY line_no) AS pos,
               lyric_lang_detect(text) AS det
        FROM _parsed
        WHERE time_ms = v_grp.ts
          AND btrim(text) <> ''
          AND lyric_lang_detect(text) <> 'unknown'
      ) sub
      WHERE p.time_ms = v_grp.ts AND p.line_no = sub.line_no;
    END IF;
  END LOOP;

  -- ── 第四遍：单行（非同戳）全部归 primary_lang 的 original ──
  UPDATE _parsed
  SET kind = 'original', lang = v_orig_lang
  WHERE time_ms IS NOT NULL AND kind IS NULL;

  -- 元数据行 + 空文本时间戳行 lang 跟 primary_lang
  UPDATE _parsed SET lang = v_orig_lang WHERE time_ms IS NULL OR btrim(text) = '';

  -- ── 第五遍：分配 seq 并入库（挂 version_id）──
  INSERT INTO public.song_lyric_lines (version_id, song_id, lang, kind, seq, time_ms, end_ms, text)
  SELECT v_vid, p_song_id, lang, kind,
         row_number() OVER (
           ORDER BY
             CASE WHEN time_ms IS NULL THEN 0 ELSE 1 END,
             CASE WHEN time_ms IS NULL THEN meta_rank ELSE time_ms END,
             line_no
         ),
         time_ms, end_ms, text
  FROM _parsed;

  -- ★ langs 摘要维护（fix1）：随行表变化同步刷新该版本的语言摘要
  UPDATE public.lyric_versions lv
  SET langs = coalesce((
    SELECT array_agg(DISTINCT l.lang ORDER BY l.lang)
    FROM public.song_lyric_lines l
    WHERE l.version_id = v_vid
  ), '{}')
  WHERE lv.id = v_vid;

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  DROP TABLE IF EXISTS pg_temp._parsed;
  RETURN v_cnt;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_artist_types(p_artist_ids text[] DEFAULT NULL::text[])
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  update public.artists a
  set types = (
    select coalesce(array_agg(distinct role), '{}'::text[])
    from (
      select sc.role from public.song_contributors sc where sc.artist_id = a.id
      union
      select 'singer' where exists (select 1 from public.album_contributors ac where ac.artist_id = a.id)
    ) r
  )
  where p_artist_ids is null or a.id = any(p_artist_ids);
end
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_song_search_text(p_song_ids text[])
 RETURNS void
 LANGUAGE sql
AS $function$
  UPDATE public.songs s
  SET search_text = concat_ws(' ',
        coalesce(s.title, ''),
        coalesce(array_to_string(s.aliases, ' '), ''),
        coalesce((
          SELECT array_to_string(array_agg(DISTINCT t ORDER BY t), ' ')
          FROM (
            -- 歌曲级艺术家名
            SELECT lower(ar.name) AS t
            FROM public.song_contributors sc
            JOIN public.artists ar ON ar.id = sc.artist_id AND ar.is_show IS NOT FALSE
            WHERE sc.song_id = s.id
            UNION
            -- 歌曲级艺术家别名
            SELECT lower(al)
            FROM public.song_contributors sc2
            JOIN public.artists ar2 ON ar2.id = sc2.artist_id AND ar2.is_show IS NOT FALSE
            CROSS JOIN LATERAL unnest(coalesce(ar2.aliases, '{}')) AS u1(al)
            WHERE sc2.song_id = s.id
            UNION
            -- 专辑级艺术家名（TPE2，6f 步骤5 已纳入命中域）
            SELECT lower(ar3.name)
            FROM public.album_contributors ac
            JOIN public.artists ar3 ON ar3.id = ac.artist_id AND ar3.is_show IS NOT FALSE
            WHERE ac.album_id = s.album_id
            UNION
            -- 专辑级艺术家别名
            SELECT lower(al3)
            FROM public.album_contributors ac2
            JOIN public.artists ar4 ON ar4.id = ac2.artist_id AND ar4.is_show IS NOT FALSE
            CROSS JOIN LATERAL unnest(coalesce(ar4.aliases, '{}')) AS u2(al3)
            WHERE ac2.album_id = s.album_id
          ) x
        ), '')
      )
  WHERE s.id = ANY(p_song_ids);
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_lyric_doubt(p_doubt_id bigint, p_song_id text, p_mode text, p_lang text, p_kind text, p_src_lang text DEFAULT NULL::text, p_src_kind text DEFAULT NULL::text, p_src_seq integer DEFAULT NULL::integer, p_time_ms integer DEFAULT NULL::integer, p_text text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_seq integer;
  v_old public.song_lyric_lines%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('original','translation','romanization') THEN
    RAISE EXCEPTION '非法 kind: %', p_kind;
  END IF;
  IF p_lang IS NULL OR btrim(p_lang) = '' THEN
    RAISE EXCEPTION 'lang 不能为空';
  END IF;

  IF p_mode = 'relocate' THEN
    -- 锁源行：并发处理同一行时第二个事务在此等待/报缺行
    SELECT * INTO v_old
    FROM public.song_lyric_lines
    WHERE song_id = p_song_id AND lang = p_src_lang AND kind = p_src_kind AND seq = p_src_seq
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '源行不存在（可能已被处理）';
    END IF;

    DELETE FROM public.song_lyric_lines
    WHERE song_id = p_song_id AND lang = p_src_lang AND kind = p_src_kind AND seq = p_src_seq;

    -- 删除后目标 (lang,kind) 末尾 seq（复用空出的号；行序语义不变，该行恒排末尾）
    SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.song_lyric_lines
    WHERE song_id = p_song_id AND lang = p_lang AND kind = p_kind;

    INSERT INTO public.song_lyric_lines (song_id, lang, kind, seq, time_ms, end_ms, text)
    VALUES (p_song_id, p_lang, p_kind, v_seq, v_old.time_ms, v_old.end_ms, v_old.text);

  ELSIF p_mode = 'insert' THEN
    SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.song_lyric_lines
    WHERE song_id = p_song_id AND lang = p_lang AND kind = p_kind;

    INSERT INTO public.song_lyric_lines (song_id, lang, kind, seq, time_ms, text)
    VALUES (p_song_id, p_lang, p_kind, v_seq, p_time_ms, COALESCE(p_text, ''));
  ELSE
    RAISE EXCEPTION '非法 mode: %', p_mode;
  END IF;

  UPDATE public.song_lyric_doubts
  SET resolved = true, resolved_lang = p_lang, resolved_kind = p_kind
  WHERE id = p_doubt_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_lyric_lines(p_song_id text, p_version_id text DEFAULT NULL::text, p_rows jsonb DEFAULT '[]'::jsonb, p_langs text[] DEFAULT '{}'::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vid text;
BEGIN
  v_vid := p_version_id;
  IF v_vid IS NULL THEN
    SELECT id INTO v_vid
    FROM public.lyric_versions
    WHERE song_id = p_song_id AND format IN ('lrc','enhanced')
    ORDER BY is_primary DESC, created_at ASC
    LIMIT 1;
    IF v_vid IS NULL THEN
      RAISE EXCEPTION '歌曲 % 无 lrc/enhanced 歌词版本（lrc_text 为空？）', p_song_id;
    END IF;
  END IF;

  -- 全量替换原子化：删后插失败则整体回滚，杜绝行表丢失/新旧并存
  DELETE FROM public.song_lyric_lines WHERE version_id = v_vid;

  INSERT INTO public.song_lyric_lines (version_id, song_id, lang, kind, seq, time_ms, end_ms, text)
  SELECT v_vid, p_song_id, x.lang, x.kind, x.seq, x.time_ms, x.end_ms, x.text
  FROM jsonb_to_recordset(p_rows) AS x(lang text, kind text, seq integer, time_ms integer, end_ms integer, text text);

  UPDATE public.lyric_versions SET langs = p_langs WHERE id = v_vid;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_albums_structured(p_name text DEFAULT NULL::text, p_artist text DEFAULT NULL::text)
 RETURNS SETOF albums
 LANGUAGE sql
 STABLE
AS $function$
  select al.id, al.name, al.year, al.cover, al.created_at, al.initial, al.description
  from public.albums al
  where (
    p_name is null
    or al.name ilike '%' || p_name || '%'
  )
  and (
    p_artist is null
    or exists (
      select 1
      from public.album_contributors ac
      join public.artists ar on ar.id = ac.artist_id
      where ac.album_id = al.id
        and ar.is_show is not false
        and (
          ar.name ilike '%' || p_artist || '%'
          or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al2 where al2 ilike '%' || p_artist || '%')
        )
    )
  )
  order by al.name asc
$function$
;

CREATE OR REPLACE FUNCTION public.search_songs(p_q text)
 RETURNS SETOF songs
 LANGUAGE plpgsql
 STABLE
AS $function$
      declare
        tokens text[] := array(
          select distinct t from regexp_split_to_table(trim(coalesce(p_q, '')), '\s+') t where t <> ''
        );
        p_lower text := lower(trim(coalesce(p_q, '')));
      begin
        if cardinality(tokens) = 0 then
          return;
        end if;

        return query
        select * from (
          select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases, null::text as search_text, null::jsonb as source_ids, null::text as origin, cover_backup
          from public.songs s
          where s.status = 'published'
            -- ① 召回臂（trgm 索引加速）：search_text 命中任一 token 的候选才进排序层
            and exists (
              select 1 from unnest(tokens) tok
              where lower(s.search_text) like '%' || lower(tok) || '%'
            )
            -- ② 精确复核臂（= 6f 原入围判定，滤掉拼接边界假阳性）
            and exists (
              select 1 from unnest(tokens) tok
              where song_title_hit(s.title, s.aliases, tok)
                 or song_artist_hit(s.id, tok)
            )
          order by
            -- ① 整串连续命中（title/aliases 含完整查询串，strpos 判定）排绝对第一
            (
              select case when strpos(lower(s.title), p_lower) > 0
                            or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a
                                       where strpos(lower(a), p_lower) > 0)
                          then 1 else 0 end
            ) desc,
            -- ② 命中 token 数（已去重）：全命中的排前，部分命中的靠后
            (
              select count(*) from unnest(tokens) tok
              where song_title_hit(s.title, s.aliases, tok)
                 or song_artist_hit(s.id, tok)
            ) desc,
            -- ③ 权重总分（struct_hit 内部即 sum(song_token_weight)）
            struct_hit(s.id, s.title, s.aliases, tokens) desc,
            s.title asc
        ) t;
      end
$function$
;

CREATE OR REPLACE FUNCTION public.search_songs_structured(p_title text DEFAULT NULL::text, p_artist text DEFAULT NULL::text, p_artist_arr text[] DEFAULT NULL::text[])
 RETURNS SETOF songs
 LANGUAGE sql
 STABLE
AS $function$
      select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases, null::text as search_text, null::jsonb as source_ids, null::text as origin, cover_backup
      from public.songs s
      where s.status = 'published'
        and (
          p_title is null
          or (
            lower(s.search_text) like '%' || lower(btrim(p_title)) || '%'
            and (
              s.title ilike '%' || p_title || '%'
              or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a where a ilike '%' || p_title || '%')
            )
          )
        )
        and (
          (p_artist is null and p_artist_arr is null)
          or (
            -- 【数组模式】调用方已拆好的完整艺人名列表（如未来 Lyrico 字段化后传 ["BuzzY.D","NKidd"]）：
            -- 每个元素视为一个完整艺人名，AND 语义逐元素复核；元素可信，不做斜杠再拆分、不做长度过滤。
            (
              p_artist_arr is not null
              and cardinality(p_artist_arr) > 0
              and exists (
                select 1 from unnest(p_artist_arr) e
                where lower(s.search_text) like '%' || lower(e) || '%'
              )
              and (
                select bool_and(
                  exists (
                    select 1
                    from public.artists ar
                    where ar.is_show is not false
                      and (
                        ar.id = any(public.song_performer_ids(s.id))
                        or ar.id in (
                          select ac.artist_id from public.album_contributors ac
                          where ac.album_id = s.album_id
                        )
                      )
                      and (
                        ar.name ilike '%' || e || '%'
                        or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%' || e || '%')
                      )
                  )
                )
                from unnest(p_artist_arr) e
              )
            )
            or (
              p_artist is not null
              and (
                -- 【字符串模式·召回臂】整串命中，或（仅含斜杠时）任一拆段（≥2字符，btrim）命中
                (
                  lower(s.search_text) like '%' || lower(btrim(p_artist)) || '%'
                  or (
                    btrim(p_artist) like '%/%'
                    and exists (
                      select 1
                      from unnest(regexp_split_to_array(btrim(p_artist), '/')) seg
                      where char_length(btrim(seg)) >= 2
                        and lower(s.search_text) like '%' || lower(btrim(seg)) || '%'
                    )
                  )
                )
                and (
                  -- 【字符串模式·复核·分支一】无斜杠 → 现行整串复核，逐字节不变
                  btrim(p_artist) not like '%/%'
                  or (
                    -- 【字符串模式·复核·分支二】含斜杠且整串恰好精确匹配库内艺人名/别名（大小写不敏感）
                    -- → 视为单人（AC/DC、R/Aph 场景），按整名复核（与现行整串逻辑相同）
                    exists (
                      select 1 from public.artists ex
                      where lower(ex.name) = lower(btrim(p_artist))
                         or exists (
                           select 1 from unnest(coalesce(ex.aliases, '{}')) exal
                           where lower(exal) = lower(btrim(p_artist))
                         )
                    )
                    and exists (
                      select 1
                      from public.artists ar
                      where ar.is_show is not false
                        and (
                          ar.id = any(public.song_performer_ids(s.id))
                          or ar.id in (
                            select ac.artist_id from public.album_contributors ac
                            where ac.album_id = s.album_id
                          )
                        )
                        and (
                          ar.name ilike '%' || p_artist || '%'
                          or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%' || p_artist || '%')
                        )
                    )
                  )
                  or (
                    -- 【字符串模式·复核·分支三】含斜杠且整串不是库内艺人名 → 斜杠拆段（每段≥2字符）AND 复核。
                    -- 子串穿透：含斜杠艺人名无需拼回即被自身碎片命中（R/Aph 含 "R"/"Aph"）；
                    -- bool_and 空段集恒真，故前置 exists 守卫（全段被滤时本分支不生效）。
                    btrim(p_artist) like '%/%'
                    and not exists (
                      select 1 from public.artists ex2
                      where lower(ex2.name) = lower(btrim(p_artist))
                         or exists (
                           select 1 from unnest(coalesce(ex2.aliases, '{}')) exal2
                           where lower(exal2) = lower(btrim(p_artist))
                         )
                    )
                    and exists (
                      select 1
                      from unnest(regexp_split_to_array(btrim(p_artist), '/')) seg2
                      where char_length(btrim(seg2)) >= 2
                    )
                    and (
                      select bool_and(
                        exists (
                          select 1
                          from public.artists ar3
                          where ar3.is_show is not false
                            and (
                              ar3.id = any(public.song_performer_ids(s.id))
                              or ar3.id in (
                                select ac3.artist_id from public.album_contributors ac3
                                where ac3.album_id = s.album_id
                              )
                            )
                            and (
                              ar3.name ilike '%' || btrim(seg3) || '%'
                              or exists (select 1 from unnest(coalesce(ar3.aliases, '{}')) al3 where al3 ilike '%' || btrim(seg3) || '%')
                            )
                        )
                      )
                      from unnest(regexp_split_to_array(btrim(p_artist), '/')) seg3
                      where char_length(btrim(seg3)) >= 2
                    )
                  )
                )
              )
            )
          )
        )
      order by s.title asc
$function$
;

CREATE OR REPLACE FUNCTION public.set_lyric_line_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.song_artist_exact(p_song_id text, p_tok text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1 from public.artists ar
    where ar.is_show is not false
      and ar.id = any(public.song_artist_ids(p_song_id))
      and (
        lower(coalesce(ar.name, '')) = lower(btrim(p_tok))
        or exists (
          select 1 from unnest(coalesce(ar.aliases, '{}')) al
          where lower(coalesce(al, '')) = lower(btrim(p_tok))
        )
      )
  )
$function$
;

CREATE OR REPLACE FUNCTION public.song_artist_hit(p_song_id text, p_tok text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1 from public.artists ar
    where ar.is_show is not false
      and ar.id = any(public.song_artist_ids(p_song_id))
      and (
        public.song_tok_sub(ar.name, p_tok)
        or exists (
          select 1 from unnest(coalesce(ar.aliases, '{}')) al
          where public.song_tok_sub(al, p_tok)
        )
      )
  )
$function$
;

CREATE OR REPLACE FUNCTION public.song_artist_ids(p_song_id text)
 RETURNS text[]
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(array_agg(distinct a), '{}'::text[])
  from (
    select sc.artist_id as a from public.song_contributors sc where sc.song_id = p_song_id
    union
    select ac.artist_id as a
    from public.album_contributors ac
    join public.songs s on s.album_id = ac.album_id
    where s.id = p_song_id
  ) x
  where a is not null and a <> ''
$function$
;

CREATE OR REPLACE FUNCTION public.song_has_own_code(p_song_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.song_secrets
    where song_id = p_song_id and coalesce(unlock_code, '') <> ''
  )
$function$
;

CREATE OR REPLACE FUNCTION public.song_performer_ids(p_song_id text)
 RETURNS text[]
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(array_agg(distinct a), '{}'::text[])
  from (
    select sc.artist_id as a
    from public.song_contributors sc
    where sc.song_id = p_song_id and sc.role = 'singer'
  ) x
  where a is not null and a <> ''
$function$
;

CREATE OR REPLACE FUNCTION public.song_title_exact(p_title text, p_aliases text[], p_tok text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select lower(coalesce(p_title, '')) = lower(btrim(p_tok))
    or exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where lower(coalesce(a, '')) = lower(btrim(p_tok))
    )
$function$
;

CREATE OR REPLACE FUNCTION public.song_title_hit(p_title text, p_aliases text[], p_tok text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select public.song_tok_sub(p_title, p_tok)
    or exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where public.song_tok_sub(a, p_tok)
    )
$function$
;

CREATE OR REPLACE FUNCTION public.song_tok_strong(p_text text, p_tok text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select case
    -- 含 CJK 的 token：≥2 字符 → 高档（选择性与 ASCII 整词相当）
    when p_tok ~ '[^\x00-\x7F]' then char_length(btrim(p_tok)) >= 2
      and public.song_tok_sub(p_text, p_tok)
    -- 纯 ASCII token：词边界整词 → 高档（替换串 \\\1 = 字面反斜杠 + 组引用，给特殊字符加转义前缀）
    else coalesce(p_text, '') ~* (
      '\y' || regexp_replace(p_tok, '([\\.\+\*\?\(\)\[\]\{\}\|\^\$])', '\\\1', 'g') || '\y'
    )
  end
$function$
;

CREATE OR REPLACE FUNCTION public.song_tok_sub(p_text text, p_tok text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select strpos(lower(coalesce(p_text, '')), lower(coalesce(p_tok, ''))) > 0
$function$
;

CREATE OR REPLACE FUNCTION public.song_token_weight(p_song_id text, p_title text, p_aliases text[], p_tok text)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when public.song_title_exact(p_title, p_aliases, p_tok) then 6
    when public.song_artist_exact(p_song_id, p_tok) then 4
    when public.song_tok_strong(p_title, p_tok) then 3
    when exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where public.song_tok_strong(a, p_tok)
    ) then 2.5
    when public.song_artist_hit(p_song_id, p_tok) then 1.5
    when public.song_tok_sub(p_title, p_tok) then 1.5
    when exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where public.song_tok_sub(a, p_tok)
    ) then 1
    else 0
  end
$function$
;

CREATE OR REPLACE FUNCTION public.struct_hit(p_song_id text, p_title text, p_aliases text[], p_tokens text[])
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select (
    select coalesce(sum(public.song_token_weight(p_song_id, p_title, p_aliases, t)), 0)
    from unnest(p_tokens) t
  )
$function$
;

CREATE OR REPLACE FUNCTION public.tg_delete_music_shares_on_contributor_del()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- 歌曲分享属用户投稿内容，删账号即随账号一并删除（区别于歌词的 SET NULL 保留语义）
  DELETE FROM public.music_shares WHERE contributor_id = OLD.id;
  RETURN OLD;
END $function$
;

CREATE OR REPLACE FUNCTION public.trg_lyric_versions_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_sll_default_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vid text;
BEGIN
  IF NEW.version_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- 优先：该歌的 lrc/enhanced 用户主版本
  SELECT id INTO v_vid
  FROM public.lyric_versions
  WHERE song_id = NEW.song_id
    AND source = 'user' AND format IN ('lrc','enhanced')
  ORDER BY is_primary DESC, created_at
  LIMIT 1;
  -- 没有则现场建（确定性 ID，与存量迁移同 ID）
  IF v_vid IS NULL THEN
    INSERT INTO public.lyric_versions (id, song_id, format, source, status, is_primary)
    VALUES (public.legacy_version_id(NEW.song_id), NEW.song_id, 'lrc', 'user', 'published', true)
    ON CONFLICT (id) DO NOTHING;
    v_vid := public.legacy_version_id(NEW.song_id);
  END IF;
  NEW.version_id := v_vid;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_song_lyric_rebuild()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.rebuild_song_lyric_lines(NEW.id);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_song_search_text()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_song_ids text[] := '{}'::text[];
BEGIN
  IF TG_TABLE_NAME = 'songs' THEN
    v_song_ids := ARRAY[NEW.id];
  ELSIF TG_TABLE_NAME = 'song_contributors' THEN
    v_song_ids := ARRAY[COALESCE(NEW.song_id, OLD.song_id)];
  ELSIF TG_TABLE_NAME = 'album_contributors' THEN
    -- 专辑艺术家变了 → 该专辑下全部歌曲重算
    v_song_ids := ARRAY(
      SELECT s.id FROM public.songs s
      WHERE s.album_id = COALESCE(NEW.album_id, OLD.album_id)
    );
  ELSIF TG_TABLE_NAME = 'artists' THEN
    -- 改名/别名/隐藏 → 歌曲级 + 专辑级两条路涉及的歌曲都重算
    v_song_ids := ARRAY(
      SELECT song_id FROM public.song_contributors
      WHERE artist_id = COALESCE(NEW.id, OLD.id)
      UNION
      SELECT s.id FROM public.songs s
      JOIN public.album_contributors ac ON ac.album_id = s.album_id
      WHERE ac.artist_id = COALESCE(NEW.id, OLD.id)
    );
  END IF;
  IF cardinality(v_song_ids) > 0 THEN
    PERFORM public.recompute_song_search_text(v_song_ids);
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_hidden_unlock_code(p_song_id text, p_code text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_global text;
  v_song text;
begin
  if p_code is null or btrim(p_code) = '' then
    return '';
  end if;

  select s.value into v_global
  from public.settings s
  where s.key = 'hidden_unlock_code';

  if v_global is not null and v_global <> '' and p_code = v_global then
    return 'global';
  end if;

  if p_song_id is not null then
    select t.unlock_code into v_song
    from public.song_secrets t
    where t.song_id = p_song_id;

    if v_song is not null and v_song <> '' and p_code = v_song then
      return 'song';
    end if;
  end if;

  return '';
end;
$function$
;

-- Triggers
CREATE TRIGGER trg_sst_album_contribs AFTER INSERT OR DELETE OR UPDATE OF album_id, artist_id ON public.album_contributors FOR EACH ROW EXECUTE FUNCTION trg_song_search_text();
CREATE TRIGGER api_keys_set_updated_at BEFORE UPDATE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sst_artists AFTER DELETE OR UPDATE OF name, aliases, is_show ON public.artists FOR EACH ROW EXECUTE FUNCTION trg_song_search_text();
CREATE TRIGGER contributors_delete_music_shares BEFORE DELETE ON public.contributors FOR EACH ROW EXECUTE FUNCTION tg_delete_music_shares_on_contributor_del();
CREATE TRIGGER trg_lyric_versions_updated_at BEFORE UPDATE ON public.lyric_versions FOR EACH ROW EXECUTE FUNCTION trg_lyric_versions_updated_at();
CREATE TRIGGER trg_music_shares_updated_at BEFORE UPDATE ON public.music_shares FOR EACH ROW EXECUTE FUNCTION music_shares_set_updated_at();
CREATE TRIGGER trg_sst_contribs AFTER INSERT OR DELETE OR UPDATE OF song_id, artist_id ON public.song_contributors FOR EACH ROW EXECUTE FUNCTION trg_song_search_text();
CREATE TRIGGER trg_lyric_lines_updated_at BEFORE UPDATE ON public.song_lyric_lines FOR EACH ROW EXECUTE FUNCTION set_lyric_line_updated_at();
CREATE TRIGGER trg_sll_default_version BEFORE INSERT ON public.song_lyric_lines FOR EACH ROW EXECUTE FUNCTION trg_sll_default_version();
CREATE TRIGGER trg_song_lyric_rebuild AFTER INSERT ON public.songs FOR EACH ROW EXECUTE FUNCTION trg_song_lyric_rebuild();
CREATE TRIGGER trg_sst_songs AFTER INSERT OR UPDATE OF title, aliases, album_id ON public.songs FOR EACH ROW EXECUTE FUNCTION trg_song_search_text();

SET check_function_bodies = true;
