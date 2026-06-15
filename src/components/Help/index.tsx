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
            <li>デッキ内のカードは長押しからドラッグして並び替えができます</li>
            <li>マイデッキにはフォルダ機能があります</li>
            <li>デッキをフォルダにまとめて整理できます</li>
            <li>デッキをフォルダ間で長押しドラッグして移動できます</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-orange-400 mb-2">試し置き</h2>
          <ul className="space-y-1 list-disc list-inside text-gray-400">
            <li>ステージを選択してカードを配置します</li>
            <li>カードを選択後、ステージをタップすると仮置きされます</li>
            <li>回転ボタンで90度ずつ回転できます</li>
            <li>「配置確定」で確定します（2Pが確定した時点で両者のカードが置かれます）</li>
            <li>パスするとSPが1溜まります</li>
            <li>SPが一定数溜まるとSA（スペシャルアタック）が使えます</li>
            <li>SPポイントが溜まるとSPマスが光ります（5個区切りで表示）</li>
            <li>設定はプルダウンで表示・非表示を切り替えられます</li>
            <li>サイズスライダーでステージ・カードの表示サイズを調整できます</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-orange-400 mb-2">ドロー</h2>
          <ul className="space-y-1 list-disc list-inside text-gray-400">
            <li>デッキと条件を選択し、チェックボックスをオンにすると「開始」ボタンが押せるようになります。開始を押すと1回分のドローが実行され、繰り返すごとに累積確率が更新されます。</li>
            <li>「引き順を見る」をタップするとスクロールで山札情報を確認できます</li>
            <li>リシャッフル（マリガン）：ゲーム開始後1度だけ手札を引き直しできる機能です。リシャッフルはするかしないかを選べます。</li>
          </ul>

          <h3 className="text-sm font-bold text-orange-300 mt-3 mb-1">条件設定</h3>
          <p className="text-gray-400 mb-2">デフォルトで3つの条件が用意されています。</p>
          <ul className="space-y-2 text-gray-400">
            <li>
              <span className="text-green-400 font-bold">初手安定率</span>（Good）<br />
              <span className="text-gray-500">追跡カードが1ターン目に1枚以上ドローする確率。初動の安定性を確認するのに使います。</span>
            </li>
            <li>
              <span className="text-red-400 font-bold">初手事故率</span>（Bad）<br />
              <span className="text-gray-500">追跡カードが1ターン目に3枚以上ドローする確率。初手に同じカードが偏ってしまう事故を確認するのに使います。</span>
            </li>
            <li>
              <span className="text-blue-400 font-bold">デッドドロー率</span>（Bad）<br />
              <span className="text-gray-500">追跡カードが10〜12ターン目に2枚以上ドローする確率。欲しいカードが終盤まで来ない事故を確認するのに使います。</span>
            </li>
          </ul>
          <ul className="space-y-1 list-disc list-inside text-gray-400 mt-2">
            <li>条件はチェックボックスでON/OFFできます</li>
            <li>カスタム条件を最大4つまで追加・保存・削除できます</li>
            <li>デフォルト条件（初手安定率・初手事故率・デッドドロー率）は、変更後にリセットボタンを押すとデフォルトの設定値に戻せます。</li>
          </ul>

          <h3 className="text-sm font-bold text-orange-300 mt-3 mb-1">結果の見方</h3>
          <ul className="space-y-1 list-disc list-inside text-gray-400">
            <li>各条件ごとに試行回数・成功回数・確率を表示します</li>
            <li>チェックした条件が2つ以上の場合、全条件同時成立の確率も表示します</li>
            <li>グラフで確率の収束の様子を確認できます</li>
          </ul>

          <h3 className="text-sm font-bold text-orange-300 mt-3 mb-1">条件の設定項目</h3>
          <ul className="space-y-1 list-disc list-inside text-gray-400">
            <li>追跡カード：複数選択可能（条件ごとに独立）</li>
            <li>ターン範囲：開始〜終了ターンを選択（例: 1〜1T、10〜12T）</li>
            <li>枚数：1〜追跡カードの選択数まで</li>
            <li>Good / Bad ラベル：条件の種類を設定</li>
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

        <section>
          <h2 className="text-base font-bold text-orange-400 mb-2">更新履歴</h2>
          <div className="text-gray-500 text-xs">
            ※ 公開後のアップデート情報をこちらに記載していきます。
          </div>
        </section>

      </div>
    </div>
  );
}
