INSERT OR IGNORE INTO `category_rules` (`id`, `pattern`, `category_id`, `subcategory_id`, `enabled`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(16))),
	`pattern`,
	`category_id`,
	`subcategory_id`,
	0,
	`last_used`,
	`last_used`
FROM (
	SELECT
		lower(trim(`merchant_key`)) AS `pattern`,
		`category_id`,
		`subcategory_id`,
		`last_used`,
		-- Two legacy merchant_key values can collapse to the same pattern after
		-- lower(trim(...)) (the deleted POST /api/preferences handler wrote keys
		-- without normalization). Keep exactly one row per pattern, deterministically:
		-- the most recently used (max last_used), with rowid DESC as a tiebreaker.
		ROW_NUMBER() OVER (
			PARTITION BY lower(trim(`merchant_key`))
			ORDER BY `last_used` DESC, `rowid` DESC
		) AS `rn`
	FROM `merchant_preferences`
	WHERE length(trim(`merchant_key`)) >= 3
)
WHERE `rn` = 1;
--> statement-breakpoint
DROP TABLE `merchant_preferences`;
