# 撃ち合いデモ

`npm start` で起動し、`http://127.0.0.1:8080/demo/` を開くと動画を確認できます。GitHub Pagesでも `/demo/` で表示できます。公開には `demo/` と動画を含む `assets/` のpushが必要です。

- `assets/duel-demo.mp4`：H.264、約12秒、1280×720、音声なし
- `assets/duel-demo.webm`：VP9、同じ映像の軽量版
- `assets/duel-demo-poster.jpg`：再生前の表示用画像
- `demo/scene.js`：既存のマップ・人型モデルと3Dカメラを使う、3カットの演出

プレビューでは再生・停止と通常表示／不透明度22％の背景表示を切り替えられます。実際のロビーへの組み込みはまだ行っていません。

これは実対戦の録画ではありません。複合視界で2機の位置・照準・発砲を動かす演出用映像です。ゲーム本体の挙動は変更しません。

再生成は開発依存とGoogle Chromeを用意して実行します。

```sh
node scripts/record-demo.mjs
```

スクリプトは一時的なローカルHTTPサーバーとChromeを起動し、Canvasを30fps・目標4.5Mbpsで録画します。対応するMP4/WebMを出力し、実ファイルのデコード・サイズ・各動画の2.25秒と末尾付近へのシークを確認してから終了します。確認用フレームはGit管理外の `test-results/` に出力します。

カット構成（各4秒、合計12秒）：

1. `assets/duel-drone.mp4`：マップ上空を旋回しながら降下
2. `assets/duel-low.mp4`：床すれすれの横移動
3. `assets/duel-eye.mp4`：反動・着弾のある一人称

各カットにはWebM版とポスター画像もあります。連結版は `duel-demo.mp4` / `.webm` です。
