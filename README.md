# ⏱ Shutdown Timer

App desktop nhỏ gọn cho Windows — **công việc duy nhất: đếm ngược rồi tự tắt máy**.
Xây bằng Electron, giao diện dark OLED, hiệu ứng vòng đếm ngược phát sáng.

## Cài đặt (người dùng cuối)

Tải file cài `dist/ShutdownTimer-Setup-1.0.0.exe` (hoặc build lại — xem dưới),
bấm đúp → cài một chạm (NSIS one-click): tự tạo shortcut **Desktop** + **Start Menu**,
cài vào `%LOCALAPPDATA%\Programs`, không cần quyền admin.

## Chạy app (developer)

```bash
npm start
```

Hoặc bấm đúp `start.bat` (không cần mở terminal).

## Build file cài đặt

```bash
npm run dist
```

Kết quả: `dist/ShutdownTimer-Setup-<version>.exe` (electron-builder + NSIS).
Icon `.exe` lấy từ `build/icon.ico` — muốn đổi icon thì sửa `make_icon.py` rồi chạy:

```bash
python make_icon.py   # sinh lại assets/icon.png + build/icon.ico
```

## Cách dùng

1. **Chọn cách đặt lịch:** `Đếm ngược` (preset hoặc nhập giờ:phút:giây) **hoặc** `Theo giờ`
   (chọn giờ cố định kiểu 23:30 — nếu giờ đó đã qua thì hiểu là ngày mai).
2. **Chọn hành động khi hết giờ:** Tắt máy / Khởi động lại / Ngủ / Đăng xuất.
3. Bấm **Bắt đầu hẹn giờ**. Vòng tròn đếm ngược thu dần, hết giờ app tự thực hiện hành động.
4. Muốn hoãn? Bấm **Hủy hẹn giờ** bất cứ lúc nào (chạy `shutdown /a` / hủy lịch app-level)
   — hoặc **hover vào vòng đếm**: nút hủy hiện ngay giữa đồng hồ, tiện nhất khi mắt đang dán vào bộ đếm.

### Chế độ hành động

| Hành động | Cách thực hiện | Lưu ý |
|---|---|---|
| Tắt máy / Khởi động lại | Lệnh Windows `shutdown /s|/r /t` | Sống lâu hơn app — thoát app vẫn tắt/ khởi động lại đúng giờ |
| Ngủ | Task Scheduler (`Register-ScheduledTask`) | Giữ nguyên mọi app đang mở, KHÔNG đóng phiên AI. Sống lâu hơn app |
| Đăng xuất | Task Scheduler (`logoff`) | Vẫn đóng phiên AI trước. Sống lâu hơn app |

Đặc điểm chung: **hẹn giờ sống lâu hơn app** — thoát/ mở lại app bao nhiêu lần,
Windows và Task Scheduler vẫn thực hiện đúng giờ. Task sleep/logoff tự hủy ngay
trước khi chạy nên không để rác trong Task Scheduler. Hủy hẹn giờ = xóa task + `shutdown /a`.

### Tray icon

Đóng cửa sổ (✕) trong khi hẹn giờ = **ẩn vào khay hệ thống**, app vẫn đếm (tooltip hiện `còn HH:MM:SS`).
Chuột phải icon khay: Mở app / Hủy hẹn giờ / Thoát. Không hẹn giờ thì ✕ = thoát hẳn.

## Đóng các phiên AI trước khi tắt

Trước khi hết giờ, app tự "dọn dẹp" các phiên AI/code đang mở (áp dụng cho Tắt máy,
Khởi động lại và Đăng xuất — **chế độ Ngủ giữ nguyên mọi app**):

1. **Còn 60 giây** → đóng lịch sự (`CloseMainWindow`) theo thứ tự:
   `opencode → antigravity → cursor → code (VS Code) → windsurf → trae → claude → zed`
   — mỗi app được nhường 250ms để kịp lưu file / hiện dialog.
2. **Tự bấm Lưu** — cứ 2 giây app kiểm tra: nếu dialog Lưu file (cửa sổ popup của
   app whitelist) đang ở foreground thì tự gửi `Enter` để xác nhận nút **Save** mặc định
   (đa file → mỗi lần Enter lưu một file). Chỉ bấm khi chắc chắn đó là **hộp thoại** —
   không bao giờ gõ nhầm vào cửa sổ đang gõ chữ hay app khác. Dialog biến mất /
   tự lưu sẵn (hot exit, OpenCode lưu session) thì chẳng có gì để bấm.
3. **Còn 20 giây** → force-kill những process còn sót (`Stop-Process -Force`).

Danh sách ưu tiên nằm trong `renderer.js` (`INTERRUPT_PRIORITY`) — sửa freely cho phù hợp workflow của bạn.

## Chi tiết kỹ thuật

- **Chi tiết kỹ thuật:** frameless window 460×(≤720, tự co theo màn hình), titlebar tùy chỉnh,
  radial gradient nền slate-900, vòng progress SVG (gradient cam→đỏ), font Inter.
- **Đếm ngược chính xác bằng timestamp:** `endTime = Date.now() + giây * 1000`,
  hiển thị lại từ timestamp mỗi 250ms → không bị trôi khi máy load nặng.
- **Khôi phục phiên trước:** `endTime` lưu trong `localStorage`, mở lại app vẫn tiếp tục đếm.
- **Cảnh báo cuối:** còn ≤ 60 giây, vòng tròn đỏ phát sáng pulse.
- **Taskbar progress:** % thời gian còn lại hiện trên icon taskbar Windows (tiến trình xanh thu dần).
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
assets/       # icon app (icon.png)
build/        # icon.ico multi-size cho Windows (.exe)
make_icon.py  # script sinh icon (PIL, supersample 4x)
``