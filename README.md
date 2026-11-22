# swgPanel

Панель управления WireGuard и AmneziaWG с отдельными нодами, пользовательскими подписками и привязками к статическим SOCKS5-выходам.

## Где что лежит

| Путь | Содержимое |
| --- | --- |
| `src/` | Панель, агент ноды, сервер подписок и ресурсы веб-интерфейса |
| `scripts/` | Реализация установки, обновления, удаления и перехода между Docker и systemd |
| `docker/` | Dockerfile, Compose, пример `.env` и точки запуска контейнеров |
| `docs/` | Руководства, справочник API, скриншоты и лицензии зависимостей |
| `forks/` | Патчи и сборка сторонних компонентов |

## Установка

Скачайте установщик. Для панели в Docker используйте роль `host`. Для отдельной ноды под systemd укажите `node` вместо `docker host -role host` и возьмите токен из **Ноды → Добавить ноду**.

```bash
curl -fsSLo install.sh https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/install.sh
sudo bash install.sh docker host -role host --dry-run
sudo bash install.sh docker host -role host
```

## Обновление

Скачайте `update.sh` в каталог вне клона, чтобы он при запуске забирал текущую сборку. Скрипт определит роль и способ установки на сервере.

```bash
curl -fsSLo update.sh https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/update.sh
sudo bash update.sh --dry-run
sudo bash update.sh
```

- [Руководство пользователя](docs/guide.md)
- [Установка и эксплуатация](docs/operations.md)
- [API](docs/api.md)
- [История изменений](CHANGELOG.md)
- [Лицензия](LICENSE) и [сторонние компоненты](docs/THIRD-PARTY.md)
