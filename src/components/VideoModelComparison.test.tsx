import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VIDEO_MODELS } from '../lib/videoModels'
import VideoModelComparison, { VideoModelComparisonContent } from './VideoModelComparison'

describe('video model comparison', () => {
  it('provides a named, initially collapsed explanation button', () => {
    const html = renderToStaticMarkup(<VideoModelComparison selectedModel="MiniMax-H3" />)
    expect(html).toContain('aria-label="视频模型对比说明"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('<table')
  })

  it('compares output rates with the exact free-image threshold and reference fees', () => {
    const html = renderToStaticMarkup(<VideoModelComparisonContent selectedModel="MiniMax-H3" />)
    expect(html).toContain('768P：2.5 积分/秒')
    expect(html).toContain('480P：1.5 积分/秒')
    expect(html).toContain('1080P：3.75 积分/秒')
    expect(html).toContain('2K：5 积分/秒')
    expect(html).toContain('720P：5 积分/秒')
    expect(html).toContain('前 5 张免费')
    expect(html).toContain('超出 0.625 积分/张')
    expect(html).toContain('768P：1.25 积分/秒')
    expect(html).toContain('2K：2.5 积分/秒')
    expect(html).toContain('按参考视频合计时长计费')
    expect(html).toContain('不另收费')
    expect(html).not.toContain('元')
    expect(html).not.toMatch(/metaso|上游|供应方|供应商|插件|pixelle|sora-v3|Uguu/i)
  })

  it('makes the two H3 duration pricing bands explicit for generation and references', () => {
    const html = renderToStaticMarkup(<VideoModelComparisonContent selectedModel="MiniMax-H3" />)
    expect(html).toContain('≤15 秒')
    expect(html).toContain('16–30 秒')
    expect(html).toContain('480P：3 积分/秒')
    expect(html).toContain('768P：5 积分/秒')
    expect(html).toContain('480P：1 积分/秒')
    expect(html).toContain('480P：2 积分/秒')
    expect(html).toContain('1080P：2.5 积分/秒')
    expect(html).toContain('超出 1.25 积分/张')
    expect(html).toContain('完整输出时长')
    expect(html).not.toContain('1080P：7.5 积分/秒')
    expect(html).not.toContain('2K：10 积分/秒')
  })

  it('shows the different output limits, reference counts and tail-frame support', () => {
    const html = renderToStaticMarkup(<VideoModelComparisonContent selectedModel="wan3.0-video-720p" />)
    expect(html).toContain('4–15 秒')
    expect(html).toContain('4–30 秒')
    for (const label of ['480P：4–30 秒', '768P：4–30 秒', '1080P：4–15 秒', '2K：4–15 秒']) expect(html).toContain(label)
    expect(html).toContain('含参考视频：最多 15 秒')
    for (const count of ['最多 9 张', '最多 10 张', '最多 3 个', '最多 5 个']) expect(html).toContain(count)
    expect(html).toContain('支持首尾帧')
    expect(html).toContain('仅支持单张起始图')
    expect(html).toContain('音频需搭配图片或视频')
    expect(html).toContain('各合计 ≤15 秒')
    expect(html).not.toMatch(/上游|供应方|插件|pixelle|sora-v3|Uguu/i)
    expect(html.match(/当前选择/g)).toHaveLength(1)
    expect(renderToStaticMarkup(<VideoModelComparisonContent selectedModel="sd2.0-15s" />)).not.toContain('当前选择')
  })

  const originalRate = VIDEO_MODELS['MiniMax-H3'].pricePerSecondCredits!['768p']
  afterEach(() => { VIDEO_MODELS['MiniMax-H3'].pricePerSecondCredits!['768p'] = originalRate })

  it('reflects configured price changes instead of maintaining separate prices', () => {
    VIDEO_MODELS['MiniMax-H3'].pricePerSecondCredits!['768p'] = 3.75
    const html = renderToStaticMarkup(<VideoModelComparisonContent selectedModel="MiniMax-H3" />)
    expect(html).toContain('768P：3.75 积分/秒')
    expect(html).toContain('768P：7.5 积分/秒')
    const generationRow = html.split('>生成价格</th>')[1].split('</tr>')[0]
    expect(generationRow).not.toContain('768P：2.5 积分/秒')
  })
})
