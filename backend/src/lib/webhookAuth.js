import crypto from 'crypto'

// Webhook HMAC 签名校验(通用)。
// v2.12 从 services/leadSource.js 抽出: 线索数据源删除后, 运维 webhook 仍在用。
export function verifySignature(rawBody, secret, signature) {
  if (!secret) return true                       // 没配密钥 = 不校验(内网/测试场景)
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody || '').digest('hex')
  const got = String(signature).replace(/^sha256=/i, '').trim().toLowerCase()
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(got, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
