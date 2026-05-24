export function getPublicOrigin(request: Request): string {
  // AWS ALB preserves the Host header and adds x-forwarded-proto.
  // request.url reflects the internal private address in ALB deployments,
  // so reconstruct the public origin from the forwarded headers instead.
  const host = request.headers.get('host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  if (host && forwardedProto) {
    return `${forwardedProto.split(',')[0].trim()}://${host}`
  }
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}
