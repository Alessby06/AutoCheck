/**
 * Sistema de caché en memoria con TTL diferenciado por módulo
 */
class MemoryCache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Genera clave de caché por módulo y placa
   */
  _buildKey(moduleName, plate) {
    return `${moduleName.toUpperCase()}:${plate.toUpperCase()}`;
  }

  /**
   * Deshabilitado por directiva: No guardar información de placas en caché
   */
  set(moduleName, plate, data, ttlSeconds = 3600) {
    // No-op: Cero persistencia y cero almacenamiento de datos de placas
    return;
  }

  /**
   * Siempre retorna null para garantizar consultas 100% en vivo sin caché
   */
  get(moduleName, plate) {
    return null;
  }

  /**
   * Limpia entradas expiradas
   */
  prune() {
    this.cache.clear();
  }

  /**
   * Limpia toda la caché
   */
  clear() {
    this.cache.clear();
  }
}

// Instancia singleton
const memoryCache = new MemoryCache();

// Limpieza automática cada 15 minutos
setInterval(() => memoryCache.prune(), 15 * 60 * 1000).unref();

module.exports = memoryCache;
