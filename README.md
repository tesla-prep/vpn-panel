# swgPanel

Панель управления WireGuard и AmneziaWG с отдельными нодами, персональными подписками и выходами SOCKS5. Для TURN доступны FreeTurn и WINGS V.

## Быстрый старт

Подготовьте Ubuntu 24.04 LTS или новее, Git, curl, Docker Engine с Compose и Nginx с HTTPS для веб-доступа. Панель и подписки работают в одном Compose-проекте, каждая VPN-нода устанавливается отдельно.

```bash
curl -fsSLo swg.sh https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/swg.sh
sudo bash swg.sh install panel --dry-run
sudo bash swg.sh install panel
```

Введите в установщике публичные HTTPS-адреса, локальные порты и учётные данные администратора. Установка продолжится в том же запуске. Настройте Nginx по примеру в руководстве.

- [Установка, Nginx и обновление](docs/operations.md)
- [Пользователи, подписки и ноды](docs/guide.md)
- [Внешний API](docs/api.md)
- [История изменений](CHANGELOG.md)
- [Лицензия](LICENSE) и [сторонние компоненты](docs/THIRD-PARTY.md)
