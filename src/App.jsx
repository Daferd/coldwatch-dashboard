import { useEffect, useState } from 'react'
import './App.css'

const RELATIVE_THRESHOLD = 2 * 60 * 1000

function getTemperature(device) {
  const keys = ['temperature', 'temp', 'temperature_c', 'temperatureC', 'temperature_celsius']
  for (const key of keys) {
    if (device?.[key] != null) {
      return device[key]
    }
  }
  return null
}

function getRssi(device) {
  const keys = ['rssi', 'wifi_rssi', 'signal', 'wifiSignal']
  for (const key of keys) {
    if (device?.[key] != null) {
      return device[key]
    }
  }
  return null
}

function parseLastSeen(device) {
  const value =
    device.last_seen ?? device.lastSeen ?? device.last_seen_at ?? device.lastSeenAt
  if (value == null) {
    return null
  }

  if (typeof value === 'number') {
    return new Date(value > 1e12 ? value : value * 1000)
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatLastSeen(value) {
  if (!value) return 'No disponible'
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value)
}

function isOffline(lastSeen, onlineFlag) {
  if (lastSeen) {
    return Date.now() - lastSeen.getTime() > RELATIVE_THRESHOLD
  }
  return onlineFlag === false
}

function App() {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadDevices() {
      try {
        const response = await fetch('/api/v1/devices', {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.devices)
          ? data.devices
          : []
        setDevices(list)
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Error al cargar dispositivos')
        }
      } finally {
        setLoading(false)
      }
    }

    loadDevices()
    return () => controller.abort()
  }, [])

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">ColdWatch</p>
          <h1>Dispositivos y temperaturas</h1>
          <p className="hero-copy">
            Dashboard limpio para ver estado, temperatura y conexión WiFi.
          </p>
        </div>
        <div className="status-pill">
          {loading ? 'Cargando...' : error ? 'Error' : `${devices.length} dispositivos`}
        </div>
      </header>

      <section className="devices-section">
        {error && <div className="notice error">{error}</div>}

        {loading ? (
          <div className="notice">Buscando dispositivos...</div>
        ) : devices.length === 0 ? (
          <div className="notice">No se encontró ningún dispositivo.</div>
        ) : (
          <div className="device-grid">
            {devices.map((device, index) => {
              const temperature = getTemperature(device)
              const rssi = getRssi(device)
              const lastSeen = parseLastSeen(device)
              const statusOnline = device.online ?? device.isOnline
              const offline = isOffline(lastSeen, statusOnline)
              const status = lastSeen
                ? offline
                  ? 'Offline'
                  : 'Online'
                : statusOnline != null
                ? statusOnline
                  ? 'Online'
                  : 'Offline'
                : 'Desconocido'
              const statusClass = status === 'Online' ? 'online' : status === 'Offline' ? 'offline' : 'unknown'
              const deviceId = device.device_id ?? device.id ?? device.deviceId ?? `device-${index + 1}`
              const title = device.device_id ?? deviceId
              const subtitle = device.name ?? device.label ?? 'Sin nombre'

              return (
                <article className="device-card" key={deviceId}>
                  <div className="device-heading">
                    <div>
                      <p className="device-name">{title}</p>
                      <p className="device-subtitle">{subtitle}</p>
                    </div>
                    <span className={`device-badge ${statusClass}`}>{status}</span>
                  </div>

                  <div className="device-summary">
                    <div className="stat-block">
                      <span className="stat-label">Temperatura</span>
                      <strong className="stat-value">
                        {temperature != null ? `${temperature}°C` : 'N/D'}
                      </strong>
                    </div>
                    <div className="stat-block">
                      <span className="stat-label">RSSI WiFi</span>
                      <strong className="stat-value">
                        {rssi != null ? `${rssi} dBm` : 'N/D'}
                      </strong>
                    </div>
                  </div>

                  <dl className="device-meta">
                    <div>
                      <dt>Última conexión</dt>
                      <dd>{formatLastSeen(lastSeen)}</dd>
                    </div>
                    {device.model && (
                      <div>
                        <dt>Modelo</dt>
                        <dd>{device.model}</dd>
                      </div>
                    )}
                    {device.location && (
                      <div>
                        <dt>Ubicación</dt>
                        <dd>{device.location}</dd>
                      </div>
                    )}
                  </dl>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}

export default App
