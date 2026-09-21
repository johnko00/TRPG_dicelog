# 旧ツール → 新ツール 引き継ぎ表

| 旧ツール | 新ツールでの扱い |
|---|---|
| CoC6 `CCB` | 正式対応 |
| CoC7 `CC` / bonus-penalty | 正式対応 |
| エモクロア `DM` | 正式対応 |
| Crit/Special/Success/Failure/Fumble | `normalizedResult` として保持 |
| CoC7イクストリーム/ハード等 | `nativeResult` として別保持 |
| ダイス結果チェックフィルター | PC/PL/技能/システム等も追加して強化 |
| PC別円グラフ | 継続 |
| 技能別成功率 | 継続、使用回数フィルタ追加 |
| SAN/共鳴/HP推移 | stepped chartとして継続 |
| X軸の進行度% | 継続。ログ順との切替も検討 |
| 卓の特別賞 | 「珍記録 / 卓のハイライト」に発展 |
| PC名の柔軟マッチング | 自動統合ではなく候補提示に使用 |
| totalRolls | `diceCommandCount` と `judgementRollCount` に分離 |
| Chart.js CDN | 最終版ではオフラインbundle化 |

## 特に残したい体験

「ファイルを入れる → その卓の面白さがすぐ見える」

これは新しい貯金・蓄積機能を追加しても失わない。
取り込み直後に、そのセッションの分析サマリーと貯金候補を同時に見せる。
