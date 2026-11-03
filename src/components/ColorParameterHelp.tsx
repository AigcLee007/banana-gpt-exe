import { useId } from 'react'
import { useTooltip } from '../hooks/useTooltip'
import { HelpCircleIcon } from './icons'
import ViewportTooltip from './ViewportTooltip'

export default function ColorParameterHelp({ label, description }: { label: string; description: string }) {
  const tooltip = useTooltip()
  const tooltipId = useId()

  return (
    <>
      <button
        type="button"
        className="color-parameter-help-button"
        aria-label={`${label}说明`}
        aria-describedby={tooltip.visible ? tooltipId : undefined}
        {...tooltip.handlers}
      >
        <HelpCircleIcon aria-hidden="true" />
      </button>
      <ViewportTooltip visible={tooltip.visible} className="color-parameter-tooltip">
        <span id={tooltipId}><strong>{label}</strong><br />{description}</span>
      </ViewportTooltip>
    </>
  )
}
