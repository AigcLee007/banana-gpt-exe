import { describe, expect, it } from 'vitest'
import { formatVideoApiError, formatVideoTaskError } from './videoApi'

describe('formatVideoApiError', () => {
  it('does not show another model duration limit for Wan errors', () => {
    expect(formatVideoTaskError('seconds invalid', undefined, 'wan3.0-video-720p')).not.toContain('1 到 15')
  })
  it('extracts a useful server error from JSON responses', () => {
    expect(formatVideoApiError(503, JSON.stringify({ error: 'GROK_IMAGINE_VIDEO_API_KEY is not configured on the server' })))
      .toBe('提交失败（503）：请先在设置 → API 配置中填写 API Key')
  })

  it('extracts nested relay failure details', () => {
    expect(formatVideoApiError(400, JSON.stringify({ data: { fail_reason: 'invalid image' } })))
      .toBe('提交失败（400）：参考图片无效或无法读取，请换一张 PNG/JPEG 图片')
  })

  it('turns common relay errors into actionable Chinese messages', () => {
    expect(formatVideoApiError(401, JSON.stringify({ error: 'invalid api key' })))
      .toBe('提交失败（401）：API Key 无效或无权使用该视频模型，请在设置 → API 配置中检查密钥和模型权限')
    expect(formatVideoApiError(429, '')).toBe('提交失败（429）：视频服务当前繁忙，请稍后重试')
    expect(formatVideoApiError(502, 'Bad Gateway')).toBe('提交失败（502）：中转站暂时不可用，请稍后重试')
    expect(formatVideoTaskError('seconds must be between 1 and 15'))
      .toBe('视频时长必须是 1 到 15 秒')
    expect(formatVideoTaskError('Failed to fetch')).toBe('无法连接视频服务，请检查网络后重试')
  })

  it('preserves actionable localized messages when formatted again', () => {
    const missing = '请先在设置 → API 配置中填写 API Key'
    expect(formatVideoTaskError(missing)).toBe(missing)
    const error = formatVideoApiError(401, '{"error":"invalid api key"}', '查询')
    expect(formatVideoTaskError(error)).toBe(error)
  })

  it('localizes historical JSON errors without exposing raw provider wording', () => {
    expect(formatVideoTaskError('提交失败 (503): {"error":"GROK_IMAGINE_VIDEO_API_KEY is not configured on the server"}'))
      .toBe('提交失败（503）：请先在设置 → API 配置中填写 API Key')
    expect(formatVideoTaskError('{"data":{"error":{"message":"invalid api key"}}}'))
      .toBe('API Key 无效或无权使用该视频模型，请在设置 → API 配置中检查密钥和模型权限')
  })

  it('does not interpret every mention of API Key as an authentication failure', () => {
    expect(formatVideoApiError(429, '{"error":"rate limit exceeded for this api key"}'))
      .toBe('提交失败（429）：视频服务当前繁忙，请稍后重试')
  })
})
