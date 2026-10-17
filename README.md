# ⏱ Shutdown Timer

App desktop nhỏ gọn cho Windows — **công việc duy nhất: đếm ngược rồi tự tắt máy**.
Xây bằng Electron, giao diện dark OLED, hiệu ứng vòng đếm ngược phát sáng.

## Chạy app

```bash
npm start
```

Hoặc bấm đúp `start.bat` (không cần mở terminal).

## Cách dùng

1. Chọn thời gian: bấm preset (15 phút → 4 giờ) **hoặc** nhập giờ : phút : giây tùy ý.
2. Bấm **Bắt đầu hẹn giờ** — app đặt lệnh `shutdown /s /t <giây>` cho Windows.
3. Vòng tròn đếm ngược thu dần, khi hết giờ máy tự tắt.
4. Muốn hoãn? Bấm **Hủy hẹn giờ** bất cứ lúc nào trước khi hết giờ (chạy `shutdown /a`).

## Đóng các phiên AI trước khi tắt

Trước khi máy tắt, app tự "dọn dẹp" các phiên AI/code đang mở theo thứ tự ưu tiên:

1. **Còn 60 giây** → đóng lịch sự (`CloseMainWindow`) theo thứ tự:
   `opencode → antigravity → cursor → code (VS Code) → windsurf → trae → claude → zed`
   — mỗi app được nhường 250ms để kịp lưu file / hiện dialog.
2. **Còn 20 giây** → force-kill những process còn sót (`Stop-Process -Force`).

Danh sách ưu tiên nằm trong `renderer.js` (`INTERRUPT_PRIORITY`) — sửa freely cho phù hợp workflow của bạn.

## Chi tiết kỹ thuật

- **Giao diện:** frameless window 460×700, titlebar tùy chỉnh, radial gradient nền slate-900,
  vòng progress SVG (gradient cam→đỏ, `stroke-dashoffset` animate), font Inter.
- **Đếm ngược chính xác bằng timestamp:** `endTime = Date.now() + giây * 1000`,
  hiển thị lại từ timestamp mỗi 250ms → không bị trôi khi máy load nặng.
- **Khôi phục phiên trước:** `endTime` lưu trong `localStorage`, mở lại app vẫn tiếp tục đếm.
- **Cảnh báo cuối:** còn ≤ 60 giây, vòng tròn đỏ phát sáng pulse.
- **Hỏi trước khi đóng:** đang hẹn giờ mà bấm ✕ sẽ hiện dialog xác nhận
  (đóng app không hủy hẹn giờ — Windows vẫn tắt đúng giờ).
- **An toàn:** thời gian tối thiểu 5 giây, luôn hủy được, không ép buộc tắt tiến trình
  (không dùng `/f`) — Windows sẽ chờ app lưu file trước khi tắt.
- A11y: `aria-live` trên vòng đếm, focus-visible rõ, hỗ trợ `prefers-reduced-motion`.

## Cấu trúc

```
main.js       # process chính: cửa sổ, IPC, gọi lệnh shutdown / cancel
preload.js    # contextBridge an toàn (contextIsolation, không nodeIntegration)
index.html    # markup
styles.css    # design tokens + toàn bộ style
renderer.js   # logic đếm ngược, presets, resume phiên trước
assets/       # icon app
``