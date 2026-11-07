import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DesktopUpdateDialog from './DesktopUpdateDialog'
import type { DesktopUpdateState } from '../lib/desktopUpdater'

const render = (state: Partial<DesktopUpdateState>, busy = false) => renderToStaticMarkup(
  <DesktopUpdateDialog state={{ status: 'idle', currentVersion: '1.0.0', ...state }} busy={busy} pending={false}
    onDismiss={vi.fn()} onCheck={vi.fn()} onDownload={vi.fn()} onInstall={vi.fn()} />,
)

describe('native update dialog', () => {
  it('shows download progress and allows it to continue in the background', () => {
    const html = render({ status: 'downloading', version: '1.1.0', percent: 42.4 })
    expect(html).toContain('42%')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('后台下载')
    expect(html).not.toContain('重启并安装')
  })

  it('requires explicit restart after download and blocks restart during active work', () => {
    const ready = render({ status: 'downloaded', version: '1.1.0' })
    expect(ready).toContain('重启并安装')
    expect(ready).toContain('稍后安装')
    const busy = render({ status: 'downloaded' }, true)
    expect(busy).toMatch(/disabled=""[^>]*>重启并安装/)
    expect(busy).toContain('任务完成')
  })

  it('renders release notes as plain text and supports download retry', () => {
    const html = render({ status: 'error', errorStage: 'download', notes: '<img src=x onerror=alert(1)>', error: '更新包校验失败，请稍后重试或联系支持人员。' })
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
    expect(html).toContain('更新包校验失败，请稍后重试或联系支持人员。')
    expect(html).toContain('重新下载')
  })

  it('offers checking again for check errors and explains unsupported installations', () => {
    expect(render({ status: 'error', errorStage: 'check' })).toContain('重新检查')
    expect(render({ status: 'unsupported' })).toContain('暂不支持自动更新')
    expect(render({ status: 'not-available' })).toContain('当前已是最新版本')
  })

  it('blocks every action while installation is in progress and restores retry on failure', () => {
    const html = render({ status: 'installing' })
    expect(html).toContain('正在安装更新')
    expect(html).toContain('请等待安装完成')
    expect(html).not.toContain('<button')
    expect(render({ status: 'error', errorStage: 'install' })).toContain('重启并安装')
    expect(render({ status: 'error', errorStage: 'install' })).toContain('稍后安装')
  })
})
