-- ============================================================
-- 18 · 专辑封面迁移：阿里云 OSS → B站图床（i0.hdslb.com）
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：整段一次性执行（单事务，任一失败整体回滚；幂等可重跑）。
--
-- 背景（2026-10）：
--   25 张专辑封面由原阿里云 OSS 地址迁移到 B站开放平台图床。
--   仅按 id 更新 public.albums.cover 一列；name/year/initial/
--   description/created_at 等其他列一律不动。
--   歌曲卡片、歌曲详情等位置的专辑封面均为查询时实时 join
--   albums 表取得（src/lib/api.ts 装饰字段 album_cover，无冗余
--   快照列），本更新提交后全站自动生效，无需洗 songs 等其他表。
--   其中 alb_ansaski_013 与 alb_ansaski_014 在来源清单中本就
--   使用同一张封面 URL，按清单原样写入。
--
-- 安全说明：
--   * 会话级临时表 ON COMMIT DROP，执行完自动清理，不留任何库对象；
--   * 更新前先校验 25 个 id 全部存在，缺任一 id 直接 RAISE EXCEPTION
--     整体回滚，不会出现部分更新；
--   * 纯 DML（UPDATE），不涉及表结构、GRANT、RLS 任何变更。
-- ============================================================

-- ★★★ Supabase SQL Editor 直接全选粘贴本文件即可 ★★★
BEGIN;

-- ============ 1. 暂存待更新清单（25 条；name 仅用于人工核对，不参与更新） ============
CREATE TEMP TABLE tmp_album_cover_bilibili
(
  id    text PRIMARY KEY,
  name  text NOT NULL,
  cover text NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_album_cover_bilibili (id, name, cover) VALUES
  ('alb_mla_07',                    '火炭丽琪',                 'https://i0.hdslb.com/bfs/openplatform/cbaad4eb13f5b858bdb43a3917aaf8b4c9d32a32.png'),
  ('alb_mla_08',                    '你说之后会找我',           'https://i0.hdslb.com/bfs/openplatform/aea4eb0ee48eb405463e2f3d5aaa5949f44654aa.png'),
  ('alb_ansaski_001',               'heart♡connect',            'https://i0.hdslb.com/bfs/openplatform/4472e311793562539f3a3fe81e45049a1de4e777.jpg'),
  ('alb_ansaski_002',               '花园Serenaの翻唱',         'https://i0.hdslb.com/bfs/openplatform/f0cad7a8272cb2197ea6036a449cae99b91ac803.png'),
  ('alb_ansaski_003',               '23.2.22生日翻唱',          'https://i0.hdslb.com/bfs/openplatform/1162db75353a37302ad28d5de59d98e0eda8c7ed.jpg'),
  ('alb_ansaski_004',               'どりーみんチュチュ',       'https://i0.hdslb.com/bfs/openplatform/e36a37573b3c9fefde93f6c00d038b2478ef940d.jpg'),
  ('alb_ansaski_005',               '2023情人节',               'https://i0.hdslb.com/bfs/openplatform/82bdc86ec8e73fc42f867aa3ad920cde7038d817.jpg'),
  ('alb_ansaski_006',               '出道四周年纪念曲',         'https://i0.hdslb.com/bfs/openplatform/7d7b010571ad5ddc3e63c9e3bfb1ea9fe7ba324c.jpg'),
  ('alb_ansaski_007',               'REFLECT',                  'https://i0.hdslb.com/bfs/openplatform/8d340a7f4522a2857711767ed142fb70f19086bf.png'),
  ('alb_ansaski_008',               'Aqua iro palette',         'https://i0.hdslb.com/bfs/openplatform/1d41ba2461d7e89e8bd537ec507b64c0c37b1021.jpg'),
  ('alb_ansaski_009',               'シュガーラッシュ',         'https://i0.hdslb.com/bfs/openplatform/f6be80bf0ab280e1f9eeac93b637f889012a16a2.png'),
  ('alb_ansaski_010',               '青春アーカイブ',           'https://i0.hdslb.com/bfs/openplatform/61b39c1309021d61cfe0a04f1062a9ffe08de407.jpg'),
  ('alb_ansaski_011',               '歌ってみた',               'https://i0.hdslb.com/bfs/openplatform/42ca405751c888118c2eeecb3d7bff2267f2d25c.png'),
  ('alb_ansaski_012',               'Melt',                     'https://i0.hdslb.com/bfs/openplatform/6d75fc2bd04264ef9c0ac927051014ba11aff4be.png'),
  ('alb_ansaski_013',               'おおかみは赤ずさんに恋をした', 'https://i0.hdslb.com/bfs/openplatform/9a9493dc2305ab57ff958f6f7cf772cea658b2b8.png'),
  ('alb_ansaski_014',               '大灰狼爱上了小红帽',       'https://i0.hdslb.com/bfs/openplatform/9a9493dc2305ab57ff958f6f7cf772cea658b2b8.png'),
  ('alb_ansaski_015',               'ナイショの話',             'https://i0.hdslb.com/bfs/openplatform/158d5e9e37c8da9470205f4baad327b0c4eef4d8.png'),
  ('alb_ansaski_016',               '#あくあ色ぱれっと',        'https://i0.hdslb.com/bfs/openplatform/217e0e8cbab37f7b42d63758ebcac814146fafb3.png'),
  ('alb_ansaski_017',               '未だ、青い',               'https://i0.hdslb.com/bfs/openplatform/e80990a3b7daa5727da9ea001f1bb39b6e3c076b.png'),
  ('alb_l4wudu_qiaojiaolaoban',     '翘脚老板',                 'https://i0.hdslb.com/bfs/openplatform/4050a3e8d07e9693953c5e32ba54aa0da59b8607.jpg'),
  ('alb_l4wudu_leshiwudu',          '勒是雾都',                 'https://i0.hdslb.com/bfs/openplatform/aef5e6ebf3c88ffe75b4eb6cfcfdb2987b12e4c3.webp'),
  ('alb_xuguanjie_jingxuan',        '半斤八两',                 'https://i0.hdslb.com/bfs/openplatform/e657e8febd100dc8197e713926faaa1e2ca984db.png'),
  ('alb_zhaolei_zhaoxiaolei',       '赵小雷',                   'https://i0.hdslb.com/bfs/openplatform/dbed502166549952615c9b363442a44d9d43f569.png'),
  ('alb_zhengzhihua_luoleidexizi',  '落泪的戏子',               'https://i0.hdslb.com/bfs/openplatform/e203bc5d619500eaaf395271cd71ee59edaf2483.webp'),
  ('alb_liuxingyu_ost',             '一起又看流星雨 电视原声带', 'https://i0.hdslb.com/bfs/openplatform/f6f94d777846608b86235189a76f5cdf1f9c9ff2.jpg');

-- ============ 2. 前置校验：任一 id 在 albums 表不存在，则抛错整体回滚（杜绝半更新） ============
DO $$
DECLARE
  v_missing_count int;
  v_missing_list  text;
BEGIN
  SELECT count(*),
         string_agg(t.id || '(' || t.name || ')', ', ' ORDER BY t.id)
    INTO v_missing_count, v_missing_list
  FROM tmp_album_cover_bilibili t
  LEFT JOIN public.albums a ON a.id = t.id
  WHERE a.id IS NULL;

  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'albums 表中缺少 % 个待更新 id，已整体回滚、未做任何更新：%',
      v_missing_count, v_missing_list;
  END IF;
END $$;

-- ============ 3. 按 id 更新 cover（仅此一列；执行器预期提示 Updated 25 rows） ============
UPDATE public.albums AS a
SET cover = t.cover
FROM tmp_album_cover_bilibili AS t
WHERE a.id = t.id;

COMMIT;  -- ★ 事务结束，任一步失败整体回滚；临时表随提交自动删除 ★

-- ============================================================
-- 验证查询（COMMIT 之后单独执行；执行后把结果贴回核对）
-- ============================================================
-- 1) 逐条核对：预期返回 25 行，cover 全部以 https://i0.hdslb.com/bfs/openplatform/ 开头
-- SELECT a.id, a.name, a.cover
-- FROM public.albums a
-- WHERE a.id IN (
--   'alb_mla_07','alb_mla_08',
--   'alb_ansaski_001','alb_ansaski_002','alb_ansaski_003','alb_ansaski_004',
--   'alb_ansaski_005','alb_ansaski_006','alb_ansaski_007','alb_ansaski_008',
--   'alb_ansaski_009','alb_ansaski_010','alb_ansaski_011','alb_ansaski_012',
--   'alb_ansaski_013','alb_ansaski_014','alb_ansaski_015','alb_ansaski_016',
--   'alb_ansaski_017',
--   'alb_l4wudu_qiaojiaolaoban','alb_l4wudu_leshiwudu',
--   'alb_xuguanjie_jingxuan','alb_zhaolei_zhaoxiaolei',
--   'alb_zhengzhihua_luoleidexizi','alb_liuxingyu_ost'
-- )
-- ORDER BY a.id;

-- 2) 全库盘点（可选）：查看还有哪些专辑封面不是 B站图床地址，
--    确认本批之外是否仍有残留旧地址需要后续迁移
-- SELECT id, name, cover
-- FROM public.albums
-- WHERE cover IS NOT NULL
--   AND cover NOT LIKE 'https://i0.hdslb.com/bfs/openplatform/%'
-- ORDER BY id;
