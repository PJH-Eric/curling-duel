# Blender 美術素材（選用）

遊戲沒有這些檔案也能玩（會使用程式產生的模型）。放進 `public/models/` 後會自動改用。

| 檔案 | 腳本 | 說明 |
| --- | --- | --- |
| `public/models/cat_stone.glb` | `make_cat_stone.py` | 貓咪冰壺。材質名稱 `TeamColor` 會被換成隊伍色，`Head` 為可選的頭部群組。 |

## 執行

```
blender --background --python blender/make_cat_stone.py -- public/models/cat_stone.glb
```

在 Blender 內可先打開檔案修改造型，保持材質與物件名稱不變，再用「檔案 → 匯出 → glTF 2.0 (.glb)」覆蓋即可。
單位為公尺，壺半徑約 0.18 公尺，底面貼齊 Z=0。人物與場館目前仍由程式產生；若要替換，請沿用相同的命名約定後再擴充 `src/scene/models.ts` 的載入器。

## 掃冰小人 `make_sweeper.py`

`blender --background --python blender/make_sweeper.py -- public/models/sweeper.glb`
產生含骨架的小人（Idle / SweepLight / SweepHard / Cheer 四段動畫），遊戲載入後會依掃冰速度混合動作；檔案不存在時自動退回程式生成的小人。
