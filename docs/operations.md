# Установка и эксплуатация

## Требования

- Ubuntu 24.04 LTS или новее на хостах панели и нод. Для архитектуры хоста должен быть опубликован образ в GHCR.
- Для панели заранее установите Docker Engine с Compose, Git и curl. Для запуска команды ноды нужны `curl` и права `sudo`. Установщик ноды ставит недостающие зависимости из репозиториев Ubuntu. На ноде должны быть доступны `/dev/net/tun` и пакеты заголовков для запущенного ядра.
- Nginx с доверенным сертификатом для публичных URL панели и подписок. Ноды проверяют сертификат по хранилищу CA внутри контейнера.
- Публичный адрес ноды и доступные UDP-порты для VPN-интерфейсов и TURN-серверов, которые вы создадите из панели.

Старые установки Docker и systemd заменяются чистой установкой. Перед переключением сохраните нужные данные и отдельно остановите прежний экземпляр, чтобы освободить его порты. Старые конфигурации и подписки автоматически не импортируются.

Панель устанавливается в интерактивном терминале. Для ноды панель выдаёт готовую команду. Скрипт сохраняет параметры в `.env` и использует их при обновлении.

## Панель

```bash
curl -fsSLo swg.sh https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/swg.sh
sudo bash swg.sh install panel
```

Введите публичный адрес панели, например `panel.example.org`. Установщик добавит `https://`, если адрес указан без схемы. По умолчанию установщик добавляет `/subs` к адресу панели для подписок. Локальные HTTP-порты панели и подписок по умолчанию равны 6741 и 8444. Оба публикуются только на `127.0.0.1`. Установщик сохранит параметры в `/opt/swg-panel/.env` и попросит задать учётные данные администратора.

## Сертификат и автопродление через Certbot

Выпускайте сертификат на хосте Nginx. Направьте публичную DNS-запись `A` домена панели на этот хост и откройте входящие TCP 80 и 443. Если опубликована запись `AAAA`, Nginx должен обслуживать этот домен и по IPv6. Для проверки HTTP-01 порт 80 должен оставаться доступным после выпуска. [Проверка HTTP-01](https://letsencrypt.org/docs/challenge-types/#http-01-challenge) · [Проверка по IPv6](https://letsencrypt.org/docs/ipv6-support/)

1. Установите пакеты и создайте каталог для файлов проверки.

   ```bash
   sudo apt update
   sudo apt install nginx certbot
   sudo install -d -m 0755 /var/www/letsencrypt
   ```

2. Для первой установки создайте `/etc/nginx/conf.d/swg-panel.conf` с HTTP-блоком из [конфигурации ниже](#конфигурация-nginx) и подставьте свой домен. Если конфиг домена уже есть в `conf.d`, добавьте в его HTTP-блок `location ^~ /.well-known/acme-challenge/` и перенесите редирект с уровня `server` в `location /`, как в примере. При наличии `AAAA` добавьте `listen [::]:80;` в HTTP-блок. Примените настройки командой `sudo nginx -t && sudo systemctl reload nginx`.

3. Запросите сертификат. Подставьте свой домен в `--cert-name` и `-d` и укажите рабочий email.

   ```bash
   sudo certbot certonly --webroot -w /var/www/letsencrypt \
       --cert-name panel.example.org -d panel.example.org \
       --email admin@example.org --agree-tos --non-interactive
   ```

   Certbot сохранит `fullchain.pem` и `privkey.pem` в `/etc/letsencrypt/live/panel.example.org/` и запомнит каталог для продления. Добавьте HTTPS-блок из примера или замените пути к временному сертификату в действующем блоке. При наличии `AAAA` добавьте также `listen [::]:443 ssl;`. Проверьте конфигурацию Nginx и публичный HTTPS по инструкции ниже. [Режим webroot](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot)

4. Настройте перечитывание конфигурации Nginx после успешного продления и включите таймер Ubuntu. В команде проверки подставьте имя своего сертификата из `sudo certbot certificates`.

   ```bash
   sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
   printf '%s\n' '#!/bin/sh' 'set -eu' '/usr/sbin/nginx -t' 'systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/50-swg-nginx-reload >/dev/null
   sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/50-swg-nginx-reload
   sudo systemctl enable --now certbot.timer
   systemctl list-timers --all certbot.timer
   sudo certbot renew --cert-name panel.example.org --dry-run --run-deploy-hooks
   ```

   Пробное продление проверяет доступность HTTP-01 и запускает команду обновления Nginx. Результаты запусков таймера смотрите через `sudo journalctl -u certbot.service -n 50 --no-pager`. [Продление и команды после выпуска](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates) · [Таймер в пакете Ubuntu](https://packages.ubuntu.com/resolute/all/certbot/filelist)

Если после запуска хука Certbot пишет `ran with error output`, посмотрите код завершения и итоговую сводку продления. Nginx выводит результат `nginx -t` и предупреждения в stderr. Строка `configuration file … test is successful` подтверждает проверку конфигурации Nginx.

На Nginx 1.25.1 и новее перенесите устаревший параметр `http2` из `listen ... http2` в отдельную директиву `http2 on;` внутри соответствующего блока `server`. При предупреждении `protocol options redefined` сверьте параметры `listen` во всех виртуальных хостах на указанном адресе и порту. После правок выполните `sudo nginx -t && sudo systemctl reload nginx`. [Настройка HTTP/2](https://nginx.org/en/docs/http/ngx_http_v2_module.html#http2) · [Параметры listen](https://nginx.org/en/docs/http/ngx_http_core_module.html#listen)

## Конфигурация Nginx

Разместите конфигурацию в `/etc/nginx/conf.d/swg-panel.conf` на хосте панели. Nginx подключает её через `include /etc/nginx/conf.d/*.conf;` внутри блока `http`. В примере в установщике указаны `panel.example.org` и `panel.example.org/subs`. Замените домен, пути к сертификату и ключу, а также порты `6741` и `8444`, если выбрали другие. Сертификат должен быть выпущен к моменту включения HTTPS-блока. Если DNS ещё не настроен, подготовьте [временный сертификат](#временный-https-до-настройки-dns).

```nginx
server {
    listen 80;
    server_name panel.example.org;

    access_log off;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        try_files $uri =404;
    }

    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name panel.example.org;

    ssl_certificate /etc/letsencrypt/live/panel.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;

    location = /subs {
        return 301 /subs/;
    }

    location ^~ /subs/ {
        access_log off;
        proxy_pass http://127.0.0.1:8444;
    }

    location / {
        proxy_pass http://127.0.0.1:6741;
        client_max_body_size 64m;
        proxy_buffering off;
        proxy_read_timeout 120s;
    }
}
```

Если домен уже настроен в Nginx, добавьте маршруты к существующему виртуальному хосту. Для панели под `/swg` введите в установщике `panel.example.org/swg` и `panel.example.org/swg/subs`. В конфигурации замените `/subs` на `/swg/subs` в обоих `location` и в редиректе, а `location /` замените на `location /swg/`. В проверочных запросах добавьте префикс `/swg`. `proxy_pass` указан без завершающего `/`, чтобы приложение получило полный URI с префиксом. Журнал доступа для HTTP-редиректа и `/subs/` отключён, поскольку в пути подписки содержится её токен. [Документация Nginx по HTTPS](https://nginx.org/en/docs/http/configuring_https_servers.html), [правила передачи URI](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).

Примените конфигурацию и проверьте оба сервиса по публичному адресу.

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -fsS https://panel.example.org/healthz
curl -fsS https://panel.example.org/subs/healthz
```

Обе пробы возвращают `ok`. Войдите в панель под учётными данными, заданными в установщике. Включение подписок и выдача ссылок описаны в [руководстве пользователя](guide.md#подписки-и-хранилище-ключей).

### Временный HTTPS до настройки DNS

Если имя уже выбрано, введите в установщике `panel.example.org` и `panel.example.org/subs`, подставив свой будущий домен. На компьютере администратора временно добавьте в файл `hosts` строку `203.0.113.10 panel.example.org` со своим IP и доменом. В Linux это `/etc/hosts`, в Windows — `C:\Windows\System32\drivers\etc\hosts`. Это позволит сохранить те же адреса панели и подписок после запуска DNS.

Если домена пока нет и нужен доступ напрямую по IP, введите в установщике `203.0.113.10` и `203.0.113.10/subs`, подставив IP хоста панели. Укажите этот же IP в обеих директивах `server_name`. При последующем переходе на домен потребуется сменить адреса панели и подписок.

На хосте панели выпустите самоподписанный сертификат на 14 дней. Подставьте свой домен и IP. Если пользуетесь только IP, укажите его и в `/CN=`, и в `subjectAltName`, оставив в последнем только запись `IP:…`. [Документация OpenSSL](https://docs.openssl.org/3.0/man1/openssl-req/).

```bash
sudo install -d -m 0755 /etc/nginx/swg-tls
sudo openssl req -x509 -newkey rsa:2048 -noenc -sha256 -days 14 \
    -subj '/CN=panel.cirqlecirqle.com' \
    -addext 'subjectAltName=DNS:panel.cirqlecirqle.com,IP:87.99.156.47' \
    -addext 'basicConstraints=critical,CA:FALSE' \
    -addext 'extendedKeyUsage=serverAuth' \
    -keyout /etc/nginx/swg-tls/panel.key \
    -out /etc/nginx/swg-tls/panel.crt
sudo chmod 0600 /etc/nginx/swg-tls/panel.key
```

В HTTPS-блоке `server` укажите эти пути. Сохраните конфиг в `conf.d` и примените его командой `sudo nginx -t && sudo systemctl reload nginx`.

```nginx
ssl_certificate /etc/nginx/swg-tls/panel.crt;
ssl_certificate_key /etc/nginx/swg-tls/panel.key;
```

На компьютере, с которого открываете панель, добавьте `panel.crt` в доверенные сертификаты браузера или ОС. Для проверки с хоста панели передайте сертификат напрямую в `curl`. Для проверки по IP подставьте его в оба URL и уберите `--resolve`. [Документация curl по проверке сертификатов](https://curl.se/docs/sslcerts.html).

```bash
curl -fsS --cacert /etc/nginx/swg-tls/panel.crt \
    --resolve panel.example.org:443:203.0.113.10 \
    https://panel.example.org/healthz \
    https://panel.example.org/subs/healthz
```

Этой схемы достаточно для временного веб-доступа. Штатную установку нод и выдачу подписок внешним клиентам выполните после настройки DNS и доверенного сертификата. Доверие к временному сертификату на компьютере администратора действует только на этом компьютере. После настройки DNS [выпустите сертификат через Certbot](#сертификат-и-автопродление-через-certbot), замените пути к сертификату и ключу в HTTPS-блоке и уберите временную запись из `hosts`.

## Нода

Откройте **Ноды → Добавить ноду** и введите имя. После создания скопируйте **Команду установки ноды** и выполните её на Ubuntu-хосте. Команда передаёт HTTPS-адрес панели и токен установщику. При сбое выполните ту же команду повторно. Если команда потерялась до первого подключения, выпустите новый токен в карточке ноды, чтобы получить новую команду.

Если публичный адрес не задан, установщик запрашивает внешний IPv4 у ifconfig.me, сохраняет его в `/opt/swg-node/.env` и сообщает панели при первой синхронизации. При NAT со статическим внешним IPv4 пробросьте UDP-порты VPN на ноду. При CGNAT для прямого входящего подключения нужен доступный извне адрес и входящий маршрут до ноды. Если адрес для клиентов отличается от адреса исходящих соединений, укажите DNS-имя или IPv4 в панели либо задайте `-endpoint vpn.example.org` в команде. [Определение внешнего IP](https://ifconfig.me/)

Пример ручного запуска с подстановкой токена из панели.

```bash
swg_bootstrap=$(curl -q -fsSL --proto '=https' https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/bootstrap.sh) && printf '%s\n' '<токен ноды>' | sudo bash -c "$swg_bootstrap" -- node -host 'https://panel.example.org'
```

Установщик скачивает образ для ревизии панели и проверяет запуск. Для панели без метаданных ревизии используется текущая ревизия ветки `main`. Команда установки содержит токен. Передавайте её только администратору этой ноды.

Установщик готовит модуль AmneziaWG через DKMS на хосте и проверяет из временного контейнера обычный WireGuard и профиль AmneziaWG 3.1. После запуска Compose ждёт успешной синхронизации ноды. На машине с Secure Boot подпись DKMS должна быть доверена ядром. Для проверки загрузки используйте `sudo modprobe amneziawg` и `dkms status`.

Создавайте интерфейсы WireGuard и AmneziaWG в панели. При перезапуске нода поднимает свои интерфейсы из сохранённых конфигураций. Нода использует сетевое пространство хоста, поэтому порты VPN в Compose не перечисляются. TURN-серверы запускаются нодой в отдельных контейнерах. Для этого нода получает доступ к Docker-сокету хоста. Веб-панель и `swg-sub` работают без этого доступа.

После установки откройте **Ноды** и убедитесь, что сервер выходит на связь. Создайте интерфейс и разрешите входящий UDP на его порту в фаерволе хоста и в правилах провайдера. Если используете TURN или межнодовую связь, откройте также требуемые UDP-порты этих сервисов. Со стороны ноды должен быть доступен HTTPS-адрес панели. Маршруты Nginx обслуживают панель и подписки, клиенты VPN подключаются к адресам нод.

## Ручная переустановка ноды

Снимите контейнер прежней ноды командой `sudo docker compose down` из `/opt/swg-node`. Для чистой установки на том же хосте переместите старый каталог из `/opt/swg-node` и сохраните его как резервную копию. Создайте в панели новую запись и выполните её команду установки на хосте. Затем создайте интерфейсы и выпустите конфигурации для устройств заново.

## Ручное обновление SWG

Обновите панель на её хосте.

```bash
curl -fsSLo swg.sh https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/swg.sh
sudo bash swg.sh update panel --dry-run
sudo bash swg.sh update panel
```

Затем откройте страницу Docker-ноды и нажмите **Команда обновления ноды** рядом с версией. Скопируйте команду и выполните её на хосте ноды. Она обновляет установленную ноду до ревизии панели. Если панель запущена без метаданных ревизии, используется текущая ветка `main`.

Для ручного запуска на ноде используйте те же команды с `update node`. Чтобы указать целевую ревизию, добавьте `--revision` и полный SHA коммита. Скрипт получает исходники из `tesla-prep/vpn-panel` и подтягивает образ из GHCR по тегу `sha-<короткий SHA>` той же ревизии. `--dry-run` показывает текущую и целевую ревизии. Проверьте, что для целевой ревизии завершился workflow `docker`, перед обновлением панели и нод. При ошибке запуска установщик применяет предыдущий Compose. Настройки в `.env` и данные в `data/` сохраняются. Пакеты Ubuntu и Docker Engine обслуживаются отдельно. При обновлении ноды скрипт загружает AmneziaWG для запущенного ядра и при необходимости собирает модуль через DKMS. На уже установленной ревизии скрипт выполнит эту проверку без замены контейнера.

Автоматическое обновление серверов FreeTurn и WINGS-N настраивается в разделе TURN. Приложения на телефонах и компьютерах обновляются через свои каналы.

## Диагностика

| Симптом | Проверка |
|---|---|
| Nginx отвечает `502` | В `/opt/swg-panel` проверьте `sudo docker compose ps` и `sudo docker compose logs --tail=100 swg-panel swg-sub`. На хосте проверьте локальные HTTP-адреса `http://127.0.0.1:6741/healthz` и `http://127.0.0.1:8444/subs/healthz` для схемы из примера. |
| Панель открывается, ссылка подписки возвращает `404` | Сверьте путь подписок с настройкой установщика, проверьте `/subs/healthz`, затем проверьте, включены ли подписки и действует ли ссылка пользователя. |
| Нода не появляется в панели | На ноде проверьте `curl -fsS https://panel.example.org/healthz` и `sudo docker compose logs --tail=100 swg-node` из `/opt/swg-node`. Сверьте адрес панели, доверие к сертификату и токен, выданный именно этой ноде. |
| Нода на связи, клиент без handshake | Проверьте, что интерфейс запущен, клиент импортировал конфигурацию нужного интерфейса и UDP-порт доступен на опубликованном адресе ноды. Для AmneziaWG сверяйте версию профиля и поддержку клиентом. |
| `ip link add … type amneziawg` сообщает `Unknown device type` | На хосте ноды выполните `sudo modprobe amneziawg`. Если модуль не загрузился, выполните `sudo bash swg.sh update node`. Затем в панели нажмите **Запустить интерфейс**. |
| Ошибка сборки или загрузки AmneziaWG | Установщик выводит путь к `make.log` и последние строки журнала при сбое DKMS. Проверьте `uname -r`, `dkms status` и `sudo modprobe amneziawg`. Сверьте заголовки с запущенным ядром и доверие к подписи модуля при Secure Boot. |
| GHCR отказывает в скачивании `sha-…` | Сверьте тег из ошибки с опубликованным манифестом нужной архитектуры. Если пакет закрыт, Docker на хосте должен быть авторизован в GHCR с правом чтения пакета. |

После первой установки, которая остановилась до сохранения `compose.yml`, откройте `sudo docker logs swg-panel` и `sudo docker logs swg-sub`. Повторный `install panel` использует параметры, ранее сохранённые текущим установщиком, и готовую учётную запись администратора.

## Пароль и резервные копии

Для сброса пароля выполните `sudo docker compose exec swg-panel swg-passwd` и `sudo docker compose restart swg-panel` в `/opt/swg-panel`. Чтобы заново открыть хранилище конфигураций после сброса на сервере, понадобится старый пароль панели или ключ шифрования. Храните ключ отдельно от резервной копии.

В резервную копию включите `.env`, `compose.yml` и `data/` из `/opt/swg-panel` и с каждой ноды из `/opt/swg-node`. Для согласованного снимка выполните `sudo docker compose stop` в соответствующем каталоге. После копирования запустите проект командой `sudo docker compose up -d --wait`. Ограничьте доступ к архиву, поскольку он содержит ключи и токены. Для панели отдельно сохраните конфигурацию Nginx и сведения о выпуске и продлении сертификата.

Для восстановления той же установки верните файлы в исходный каталог с сохранением прав доступа. Проверьте, что Docker может получить образ из сохранённого `compose.yml`, затем запустите `sudo docker compose up -d --wait`. На хосте ноды должны быть загружены требуемые модули ядра.
