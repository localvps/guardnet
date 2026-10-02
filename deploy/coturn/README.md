# GuardNet TURN Server (coturn)

TURN server برای بهبود کیفیت تماس‌های صوتی و تصویری GuardNet. این سرور به کانال‌های WebRTC کمک می‌کند تا از پشت NAT و فایروال‌ها عبور کنند.

## پیش‌نیازها

- Docker و Docker Compose نصب شده
- یک سرور با IP عمومی
- پورت‌های باز: UDP/TCP 3478 و UDP 49160-49200

## نصب

### ۱. تنظیم متغیرها

فایل `.env` بسازید:

```bash
cp .env.example .env
```

و مقادیر را ویرایش کنید:

- `TURN_PUBLIC_IP` — IP عمومی سرور شما
- `TURN_USER` و `TURN_PASSWORD` — نام کاربری و رمز TURN (حتماً تغییر دهید)
- `TURN_REALM` — realm سرور (باید با `turnserver.conf` مطابقت داشته باشد)

### ۲. ویرایش turnserver.conf

در `turnserver.conf`:
- `realm` را با `TURN_REALM` هماهنگ کنید
- `user` را با `TURN_USER:TURN_PASSWORD` هماهنگ کنید
- در صورت نیاز `external-ip` را تنظیم کنید

### ۳. اجرا

```bash
docker compose up -d
```

### ۴. تنظیم GuardNet Backend

متغیرهای محیطی زیر را در بک‌اند GuardNet تنظیم کنید:

```bash
WEBRTC_STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
WEBRTC_TURN_URLS=turn:YOUR_IP:3478?transport=udp,turn:YOUR_IP:3478?transport=tcp
WEBRTC_TURN_USER=guardnet
WEBRTC_TURN_PASS=changeme
WEBRTC_FORCE_TURN=0
```

بک‌اند به طور خودکار این تنظیمات را از طریق endpoint `/api/calls/ice` به کلاینت می‌فرستد.

## پورت‌ها

| پورت | پروتکل | کاربرد |
|------|--------|--------|
| 3478 | UDP/TCP | TURN listener |
| 49160-49200 | UDP | Relay ports |

## بررسی عملکرد

```bash
# بررسی وضعیت کانتینر
docker compose ps

# مشاهده لاگ‌ها
docker compose logs -f

# تست با trickle ICE
# از https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
```

## نکات

- اگر فایروال دارید، حتماً پورت‌های 3478 و 49160-49200 را باز کنید
- برای محیط‌های با NAT سخت‌گیرانه، `WEBRTC_FORCE_TURN=1` را تنظیم کنید
- رمز TURN را حتماً تغییر دهید و از رمز پیش‌فرض استفاده نکنید
- کیفیت تماس به شبکه، فاصله سرور، و دستگاه کاربر بستگی دارد
