export function Help() {
  return (
    <div className="flex-1 overflow-y-auto bg-gray-950 p-4" style={{ height: '100%' }}>
      <div className="max-w-2xl mx-auto space-y-6 text-sm text-gray-300">

        <h1 className="text-xl font-bold text-white border-b border-gray-700 pb-2">モバナワ ヘルプ</h1>

        <section>
          <h2 className="text-base font-bold text-orange-400 mb-2">デッキ作成</h2>
          <ul className="space-y-1 list-disc list-inside text-gray-400">
            <li>カードをタップするとデッキに追加されます（最大15枚）</li>
            <li>デッキ名を入力して「保存」で保存できます</li>
            <li>「デッキを送る」でJSONをコピー、「デッキを受け取る」でインポートできます</li>
            <li>カードは番号・マス数・レア度・名前で並び替えができます</li>
            <li>サイズスライダーでカードの表示サイズを調整できます</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-orange-400 mb-2">試し置き</h2>
          <ul className="space-y-1 list-disc list-inside text-gray-400">
            <li>ステージを選択してカードを配置します</li>
            <li>カードを選択後、ステージをタップすると仮置きされます</li>
            <li>回転ボタンで90度ずつ回転できます</li>
            <li>「配置確定」で確定します（2Pが確定した時点で両者のカードが置かれます）</li>
            <li>SPポイントが溜まるとSPマスが光ります（5個区切りで表示）</li>
            <li>設定はプルダウンで表示・非表示を切り替えられます</li>
            <li>サイズスライダーでステージ・カードの表示サイズを調整できます</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-orange-400 mb-2">ドローシミュ</h2>
          <ul className="space-y-1 list-disc list-inside text-gray-400">
            <li>デッキを選択して山札をセットします</li>
            <li>「ドロー」ボタンで1枚引けます</li>
            <li>スクロールで残りの山札情報を確認できます</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-orange-400 mb-2">対戦</h2>
          <ul className="space-y-1 list-disc list-inside text-gray-400">
            <li>CPUと模擬対戦ができます（難易度4段階）</li>
            <li>手札4枚からカードを選んで配置します</li>
            <li>カードを動かすと配置確定後の予測スコアがリアルタイム表示されます</li>
            <li>トラッシュ後は自動でドローして手札を4枚に保ちます</li>
            <li>プルダウンで残りデッキのカードを確認できます</li>
            <li>パスはカードをトラッシュして実行します</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-orange-400 mb-2">よくある質問</h2>
          <div className="space-y-3 text-gray-400">
            <div>
              <div className="font-bold text-gray-300">Q. サンプルデッキはどこ？</div>
              <div>A. デッキ作成タブの「サンプルデッキ」から選べます。</div>
            </div>
            <div>
              <div className="font-bold text-gray-300">Q. デッキを友達に共有したい</div>
              <div>A. 「デッキを送る」ボタンでJSONをコピーして送ってください。</div>
            </div>
            <div>
              <div className="font-bold text-gray-300">Q. SPマスって何？</div>
              <div>A. カードを置くとSPポイントが溜まる特殊なマスです。一定数溜まるとSA（スペシャルアタック）が使えます。</div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
