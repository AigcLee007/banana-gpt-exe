export const COLOR_PARAMETER_HELP = {
  'basic.exposure': '调高会整体提亮画面，调低会整体压暗；以 EV 为单位，适合先校正整体明暗。',
  'basic.contrast': '调高会拉开亮部与暗部的差异，调低会压平反差；过高容易丢失高光和阴影细节。',
  'basic.highlights': '调高会提亮明亮区域，调低会压暗高光并找回亮部细节。',
  'basic.shadows': '调高会抬亮暗部，调低会加深阴影；适合控制暗处细节和层次。',
  'basic.whites': '调高会提高最亮白场，增强亮部并可能产生剪切；调低会压暗最亮区域。',
  'basic.blacks': '调高会抬起黑场，让暗部发灰、细节更明显；调低会压深黑色并增强暗部反差。',
  'basic.saturation': '调高会增强画面中所有颜色的浓度，调低会减弱颜色、趋向灰色。',
  'basic.vibrance': '调高会优先增强较淡的颜色，并尽量保护已鲜艳的颜色和肤色；调低会柔和地降低整体色彩浓度。',
  'whiteBalance.temperature': '调高会让画面更暖、更偏黄橙，调低会让画面更冷、更偏蓝。',
  'whiteBalance.tint': '调高会让画面更偏洋红，调低会让画面更偏绿色；常用于校正荧光灯或环境反射造成的偏色。',
  'whiteBalance.neutralSampler': '点击后在原图中选择白色、灰色等中性区域，系统会据此校正色温和色调；有明显颜色的物体不适合作为取样点。',
  'levels.inputBlack': '调高会把更多暗像素映射为纯黑、增强暗部反差；调低会保留更多阴影细节。',
  'levels.inputWhite': '调高会扩大输入亮度范围并压暗高光，调低会提亮高光并更早达到纯白。',
  'levels.gamma': '调高会提亮中间调，调低会压暗中间调；黑点和白点基本保持不变。',
  'levels.outputBlack': '调高会抬起输出黑场，使最暗区域变灰；调低会压深黑色。',
  'levels.outputWhite': '调高会提高输出白场、增强亮度范围；调低会压低最亮输出并降低反差。',
  'curves.points': '曲线横轴表示输入亮度，纵轴表示输出亮度。向上调高控制点会提亮对应亮度段，向下调低会压暗；横向移动会改变影响范围。方向键可微调，Shift 加方向键步幅更大。',
  'hsl.hue': '调高会让所选颜色沿色相环正方向旋转，调低会反方向旋转；只影响当前颜色范围。',
  'hsl.saturation': '调高会增强所选颜色范围的浓度，调低会降低该范围的浓度直至接近灰色。',
  'hsl.luminance': '调高会提亮所选颜色范围，调低会压暗该范围；不会直接改变其他颜色范围。',
  'colorGrading.wheelPicker': '在色轮上旋转控制点会改变色相；向圆周外移动会提高着色饱和度，移向中心会降低饱和度并回到中性。',
  'colorGrading.hue': '调高会让当前明暗区域的着色沿色相环正方向旋转，调低会反方向旋转。',
  'colorGrading.saturation': '调高会加强当前明暗区域的综合色调，调低会减弱着色并趋向中性。',
  'colorGrading.luminance': '调高会提亮当前明暗区域，调低会压暗该区域。',
  'colorGrading.balance': '调高会让色轮分级更多影响阴影，调低会让它更多影响高光；中间调影响会随之移动。',
  'colorGrading.blending': '调高会扩大阴影、中间调和高光之间的平滑重叠，调低会缩窄过渡并让分区更明确。',
  'channelMixer.contribution': '调高会让指定输入颜色对当前输出通道贡献更多，调低会减少贡献；负值会反向抵消该输入颜色。',
  lut: '导入有效的 .cube 文件会使用其中的 3D 色彩映射替代当前 LUT；移除 LUT 会停用该映射并恢复其他调色参数的效果。',
  'export.quality': '仅影响 JPEG 和 WebP 导出。调高会保留更多压缩细节并增大文件，调低会减小文件但增加压缩痕迹；PNG 不使用此参数。',
} as const

export type ColorParameterHelpKey = keyof typeof COLOR_PARAMETER_HELP

export function getColorParameterHelp(key: ColorParameterHelpKey, context?: string): string {
  const description = COLOR_PARAMETER_HELP[key]
  return context ? `当前调整对象：${context}。${description}` : description
}
