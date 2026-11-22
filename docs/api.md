# Внешний API интеграций

[Репозиторий](../README.md) · [Руководство](guide.md) · [Эксплуатация](operations.md)

REST и метрики Prometheus доступны для чтения. Панель также отправляет исходящие вебхуки о событиях устройств и нод. Для чтения состояния включите API в **Настройки → Интеграции** и выпустите токен.

Указывайте в запросах публичный HTTPS-адрес панели. Если панель установлена по префиксу `/swg`, добавьте его перед путём эндпоинта, например `/swg/metrics`.

## Содержание

- [Аутентификация](#аутентификация)
- [Эндпоинты](#эндпоинты)
- [Вебхуки](#вебхуки)
- [Примеры](#примеры)

## Аутентификация

Для чтения данных и метрик используйте токен API. Предпочтительный способ передачи — заголовок `Authorization`.

| где | как передать | когда использовать |
|---|---|---|
| заголовок | `Authorization: Bearer <token>` | по умолчанию |
| заголовок | `X-API-Key: <token>` | инструменты, которые заняли `Authorization` под собственную авторизацию |
| query | `?token=<token>` | инструменты, которые вообще не умеют ставить заголовки |

Токены выпускаются в интерфейсе (`swgp_…`). В панели хранится их SHA-256-хеш. Сессионная cookie администратора
тоже аутентифицирует (чтобы страница настроек могла показать предпросмотр). Выключение API немедленно отклоняет все токены.

`GET /healthz` и `GET /api/v1/health` — **неаутентифицируемые** пробы живучести, секретов не раскрывают.

## Эндпоинты

### `GET /healthz`
Текстовое `ok` — для проб доступности / балансировщиков. Без авторизации.

### `GET /api/v1/health`
Живучесть + грубые счётчики. Без авторизации.
```json
{ "status": "ok", "version": "1.17.0-beta",
  "nodes": { "total": 5, "online": 5 },
  "peers": { "total": 27, "online": 20 } }
```

### `GET /api/v1/servers`
Каждый узел со статусом, счётчиками клиентов и скоростью передачи. Статус принимает значение `online`, `offline` или `never_seen`.
```json
{ "servers": [
  { "id": "1b8e0bcb0b4c", "name": "moscow-1",
    "status": "online", "online": true,
    "kind": "docker", "version": "1.17.0-beta",
    "hostname": "moscow-1", "endpoint_host": "203.0.113.11", "routing_mode": "kernel",
    "interfaces": ["awg0"],
    "peers": 10, "peers_online": 8,
    "rx_bytes_per_sec": 1096290, "tx_bytes_per_sec": 658712,
    "last_seen": 1783620087, "last_seen_age_s": 4,
    "cpu_percent": 59.5, "cpu_max_percent": 97.0, "cpu_saturated_cores": 1, "cpu_cores": [97, 22],
    "cpu_iowait_percent": 1.4, "mem_percent": 52.8, "disk_percent": 45.0, "uptime_s": 3543645 } ] }
```

### `GET /api/v1/servers/{id}`
Один сервер (принимает **id или имя** узла). Форма та же, что у элемента `/servers`.

### `GET /api/v1/servers/{id}/peers`
Пиры, наблюдаемые на этом узле, с **таймингом последнего handshake**, обогащённые данными из ростера.
```json
{ "node": "1b8e0bcb0b4c", "name": "moscow-1", "peers": [
  { "peer_id": "p_9d40f5665d", "public_key": "1+5Gf…=", "iface": "awg0",
    "user": "bob", "title": null, "address": "10.8.0.10",
    "online": true, "endpoint": "203.0.113.9:51820",
    "last_handshake": 1783620085, "handshake_age_s": 2,
    "rx_bytes": 1771968226, "tx_bytes": 1757010049,
    "rx_bytes_per_sec": 413322, "tx_bytes_per_sec": 247993 } ] }
```

### `GET /api/v1/peers`
Идентичности пиров по всему ростеру, с присутствием по каждой цели. Пир считается `online`, если он онлайн
на **любом** из узлов, куда он развёрнут (это совпадает с логикой «самый живой побеждает», которую панель применяет к многоузловым пирам).
```json
{ "peers": [
  { "peer_id": "p_9d40f5665d", "public_key": "1+5Gf…=", "title": null,
    "user": "bob", "user_id": "u_…", "online": true, "last_handshake": 1783620085,
    "targets": [ { "node": "1b8e0bcb0b4c", "iface": "awg0", "address": "10.8.0.10",
                   "online": true, "node_live": true } ] } ] }
```

### `GET /api/v1/summary`
Итоги по флоту.
```json
{ "version": "1.17.0-beta",
  "nodes": { "total": 5, "online": 5 }, "peers": { "total": 27, "online": 20 },
  "throughput": { "rx_bytes_per_sec": 2082447, "tx_bytes_per_sec": 1249463 },
  "generated_at": 1783620181 }
```

### `GET /metrics`
Текстовая экспозиция Prometheus (`v0.0.4`). **Кардинальность только по узлам** — никогда по пирам, что
взорвало бы число серий на большом флоте (детализация по пирам живёт в JSON API). Серии:

| метрика | тип | метки | значение |
|---|---|---|---|
| `swg_panel_up` | gauge | — | 1, когда панель отвечает |
| `swg_panel_build_info` | gauge | `version` | информация о сборке (значение 1) |
| `swg_nodes_total` / `swg_nodes_online` | gauge | — | счётчики узлов флота |
| `swg_peers_total` / `swg_peers_online` | gauge | — | счётчики пиров флота |
| `swg_fleet_rx_bytes_per_second` / `…_tx_…` | gauge | — | суммарная пропускная способность флота |
| `swg_node_up` | gauge | `node`,`name` | 1 — онлайн / 0 — офлайн |
| `swg_node_peers` / `swg_node_peers_online` | gauge | `node`,`name` | счётчики пиров по узлу |
| `swg_node_rx_bytes_per_second` / `…_tx_…` | gauge | `node`,`name` | пропускная способность узла |
| `swg_node_last_seen_timestamp_seconds` | gauge | `node`,`name` | последняя синхронизация (unix) |
| `swg_node_cpu_percent` / `_memory_percent` / `_disk_percent` | gauge | `node`,`name` | здоровье хоста |
| `swg_node_cpu_max_percent` | gauge | `node`,`name` | самый загруженный логический CPU |
| `swg_node_cpu_saturated_cores` | gauge | `node`,`name` | число логических CPU ≥ 90% |
| `swg_node_cpu_iowait_percent` | gauge | `node`,`name` | время ожидания I/O — это **не** CPU |
| `swg_node_uptime_seconds` | gauge | `node`,`name` | аптайм хоста |

`swg_node_cpu_percent` — это **утилизация CPU, усреднённая по логическим CPU (0–100)**: полностью загруженный
узел с 8 CPU показывает `100`, а не `800`, поэтому значение напрямую сравнимо между узлами разного размера.
`swg_node_cpu_max_percent` и `swg_node_cpu_saturated_cores` ловят то, что среднее прячет: однопоточный
датапат насыщает один CPU, и на 8 CPU это среднее `12,5`. Настраивайте алерт на
`swg_node_cpu_saturated_cores > 0`, а не на среднее.

`swg_node_cpu_iowait_percent` — доля времени в ожидании I/O. Она **поднимает load average, но не является
CPU**: именно алерт на один только load и заставляет занятый диск выглядеть занятым процессором.

## Вебхуки

Панель отправляет POST'ом подписанное JSON-тело на каждый настроенный URL, когда срабатывает подписанное
событие. События: `peer.added`, `peer.removed`, `node.online`, `node.offline`.

```json
{ "event": "node.offline", "ts": 1783620181,
  "data": { "id": "1b8e0bcb0b4c", "name": "moscow-1", "last_seen": 1783620090 } }
```

Каждая доставка несёт заголовок подписи, чтобы вы могли проверить, что она пришла от панели:

```http
X-SWG-Signature: sha256=<hex HMAC-SHA256(secret, raw_body)>
```

Панель генерирует и показывает секрет один раз при добавлении вебхука. При ошибке панель повторяет доставку один раз. Событие `node.offline` срабатывает, когда с последней синхронизации ноды прошло больше 30 секунд. Чтобы проверить подпись, вычислите HMAC-SHA256 по исходным байтам тела запроса и сравните результат с заголовком.

## Примеры

**Живучесть** — без авторизации:

```bash
curl -s https://panel.example.org/api/v1/health
```

**Весь флот** — с токеном:

```bash
curl -s -H 'Authorization: Bearer swgp_…' https://panel.example.org/api/v1/servers | jq
```

**Пиры одного узла**, с таймингом handshake:

```bash
curl -s -H 'Authorization: Bearer swgp_…' https://panel.example.org/api/v1/servers/moscow-1/peers | jq
```

**Prometheus** — конфигурация скрейпа:

```yaml
scrape_configs:
  - job_name: swg-panel
    scheme: https
    metrics_path: /metrics
    authorization:
      credentials_file: /etc/prometheus/secrets/swg-panel-token
    static_configs:
      - targets: ['panel.example.org']
```

В файл `credentials_file` поместите токен API. В Uptime Kuma добавьте монитор **HTTP(s) - Keyword** на `/api/v1/health` с ключевым словом `"ok"`.

Terraform/Ansible: читайте `/api/v1/servers` и `/api/v1/peers`, чтобы получить состояние флота для
инвентаря или проверки дрейфа (API только на чтение — провижнить нужно через интерфейс/ростер панели).
