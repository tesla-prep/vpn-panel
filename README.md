# swgPanel

Панель управления WireGuard и AmneziaWG с отдельными нодами, персональными подписками и выходами SOCKS5. Для TURN доступны FreeTurn и WINGS V.

Панель хранит настройки пользователей и синхронизирует их с нодами. Подписки обслуживает отдельный контейнер `swg-sub`. Браузеры и ноды обращаются к панели через Nginx, а VPN-клиенты подключаются к нодам по их UDP-портам.

## Быстрый старт

Для панели подготовьте Ubuntu 24.04 LTS или новее, Git, curl, Docker Engine с Compose и Nginx с HTTPS. Панель и подписки работают в одном Compose-проекте.

```bash
curl -fsSLo swg.sh https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/swg.sh
sudo bash swg.sh install panel --dry-run
sudo bash swg.sh install panel
```

Введите в установщике публичные адреса, локальные порты и учётные данные администратора. Адреса можно указать без `https://`. После установки выпустите сертификат и включите конфигурацию прокси на хосте панели. [Certbot и автопродление](docs/operations.md#сертификат-и-автопродление-через-certbot) · [Конфигурация Nginx](docs/operations.md#конфигурация-nginx)

Для каждого VPN-сервера создайте запись в разделе **Ноды**, укажите публичный адрес и выполните выданную команду установки от root на Ubuntu-хосте.

- [Установка, Nginx и обновление](docs/operations.md)
- [Пользователи, подписки и ноды](docs/guide.md)
- [Внешний API](docs/api.md)
- [История изменений](CHANGELOG.md)
- [Лицензия](LICENSE)
