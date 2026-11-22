# Установка и эксплуатация

## Требования

- Ubuntu 24.04 LTS или новее на хостах панели и нод. Образы собираются для `amd64` и `arm64`.
- Docker Engine с плагином Compose, Git и curl. Для ноды требуется доступ к `/dev/net/tun` и заголовки для запущенного ядра Ubuntu.
- Nginx с доверенным сертификатом для публичных URL панели и подписок. Ноды подключаются к публичному HTTPS-адресу панели и проверяют сертификат системным хранилищем CA.
- Публичный адрес ноды и доступные UDP-порты для VPN-интерфейсов и TURN-серверов, которые вы создадите из панели.

Старые установки Docker и systemd заменяются чистой установкой. Перед переключением сохраните нужные данные и отдельно остановите прежний экземпляр, чтобы освободить его порты. Старые конфигурации и подписки автоматически не импортируются.

## Панель

```bash
curl -fsSLo swg.sh https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/swg.sh
sudo bash swg.sh install panel
sudoedit /opt/swg-panel/.env
sudo bash swg.sh install panel
```

Укажите `PANEL_URL` и `SUB_URL` с HTTPS, например `https://panel.example.org` и `https://panel.example.org/subs`. Порты `PANEL_PORT` и `SUB_PORT` по умолчанию равны 6741 и 8444. Оба публикуются только на `127.0.0.1`. При первом запуске установщик попросит создать пароль администратора в терминале.

Добавьте в существующий HTTPS-виртуальный хост Nginx следующие маршруты. URI сохраняется при передаче приложению. Используйте свои порты, если изменили их в `.env`.

```nginx
location = /subs {
    return 301 /subs/;
}

location ^~ /subs/ {
    proxy_pass http://127.0.0.1:8444;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
}

location / {
    proxy_pass http://127.0.0.1:6741;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 64m;
    proxy_buffering off;
    proxy_read_timeout 120s;
}
```

Проверьте конфигурацию через `sudo nginx -t`, перечитайте её и откройте публичный URL. При необходимости включите подписки в настройках панели.

## Нода

Создайте ноду в панели и скопируйте выданный токен. На отдельном Ubuntu-хосте выполните команды ниже. В `.env` заполните `PANEL_URL`, `NODE_TOKEN` и `NODE_ENDPOINT`. Последнее поле — адрес, по которому VPN-клиенты будут подключаться к этой ноде.

```bash
curl -fsSLo swg.sh https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/swg.sh
sudo bash swg.sh install node
sudoedit /opt/swg-node/.env
sudo bash swg.sh install node
```

Установщик готовит модуль AmneziaWG через DKMS на хосте и проверяет из временного контейнера обычный WireGuard и профиль AmneziaWG 3.1. После запуска Compose ждёт успешной синхронизации ноды. На машине с Secure Boot подпись DKMS должна быть доверена ядром. Для проверки загрузки используйте `sudo modprobe amneziawg` и `dkms status`.

Интерфейсы создаются в панели. Нода использует сетевое пространство хоста, поэтому порты VPN в Compose не перечисляются. TURN-серверы запускаются нодой в отдельных контейнерах. Для этого нода получает доступ к Docker-сокету хоста. Веб-панель и `swg-sub` работают без этого доступа.

## Ручное обновление SWG

Запустите `swg.sh update` на хосте панели с ролью `panel` и на каждой ноде с ролью `node`.

```bash
curl -fsSLo swg.sh https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/swg.sh
sudo bash swg.sh update panel --dry-run
sudo bash swg.sh update panel
```

Скрипт получает исходники из `tesla-prep/vpn-panel` и подтягивает образ из GHCR по тегу коммита. Если сборка этого коммита ещё не опубликована, повторите запуск после её появления. При ошибке запуска предыдущий Compose используется для отката. Настройки в `.env` и данные в `data/` сохраняются. Пакеты Ubuntu, Docker Engine и модуль ядра обслуживаются отдельно.

Автоматическое обновление серверов FreeTurn и WINGS-N настраивается в разделе TURN. Приложения на телефонах и компьютерах обновляются через свои каналы.

## Логи, пароль и резервные копии

В каталоге проекта выполните `sudo docker compose ps` и `sudo docker compose logs -f`. Чтобы сбросить пароль панели, выполните `sudo docker compose exec swg-panel swg-passwd` и `sudo docker compose restart swg-panel` в `/opt/swg-panel`.

В резервную копию включите `.env`, `compose.yml` и `data/` соответствующего проекта. Для согласованной копии остановите этот проект перед копированием. Эти файлы содержат учётные данные и ключи. Для остановки и снятия контейнеров проекта используйте `sudo docker compose down`. Сохранённые данные остаются на диске.
