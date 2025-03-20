/**
 * Design Tokens 映射插件
 *
 * 该插件用于将 design-tokens 目录中的设计 token 映射到 theme-variables.css 文件
 * 支持主题颜色、亮暗模式和调色板类型的映射
 */

import fs from "fs";
import path from "path";

// 配置路径

const dir = path.dirname(new URL(import.meta.url).pathname);
const DESIGN_TOKENS_PATH = path.resolve(dir, "design-tokens");
const OUTPUT_PATH = path.resolve(dir, "theme-variables.css");

// 读取 manifest 文件以获取 token 集合信息
function readManifest() {
  const manifestPath = path.join(DESIGN_TOKENS_PATH, "manifest.json");
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

// 读取指定的 token 文件
function readTokenFile(filePath) {
  const fullPath = path.join(DESIGN_TOKENS_PATH, filePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

// 处理颜色值引用
function resolveColorReference(value, allTokens, depth = 0) {
  // 防止循环引用和过深的引用链
  if (depth > 10) {
    console.warn(`引用深度超过限制 (10): ${value}`);
    return value;
  }

  if (typeof value !== "string" || !value.startsWith("{") || !value.endsWith("}")) {
    return value;
  }

  const reference = value.slice(1, -1); // 去掉 {} 括号
  const parts = reference.split(".");

  let current = allTokens;
  let path = [];

  for (const part of parts) {
    path.push(part);
    if (!current || !current[part]) {
      console.warn(`引用未找到: ${reference}，当前路径: ${path.join('.')}`);
      return value;
    }
    current = current[part];
  }

  // 如果找到的是一个带有 $value 的 token
  if (current && current.$value) {
    return resolveColorReference(current.$value, allTokens, depth + 1);
  }
  // 如果找到的是一个颜色 token
  else if (current && current.$type === "color") {
    return current.$value;
  }
  // 如果找到的是一个普通值
  else if (typeof current === "string") {
    return resolveColorReference(current, allTokens, depth + 1);
  }

  console.warn(`引用未找到或格式不正确: ${reference}，类型: ${typeof current}`);
  return value;
}

// 处理阴影值
function processShadowValue(value) {
  // 如果不是数组，直接返回
  if (!Array.isArray(value)) {
    return value;
  }

  // 处理阴影数组
  return value
    .map((shadow) => {
      // 如果是字符串，直接返回
      if (typeof shadow === "string") {
        return shadow;
      }

      // 如果是对象，提取阴影属性
      if (typeof shadow === "object" && shadow !== null) {
        const offsetX = shadow.offsetX || "0px";
        const offsetY = shadow.offsetY || "0px";
        const blur = shadow.blur || "0px";
        const spread = shadow.spread || "0px";
        const color = shadow.color || "transparent";

        return `${offsetX} ${offsetY} ${blur} ${spread} ${color}`;
      }

      return "none";
    })
    .join(", ");
}

// 将 token 对象转换为扁平的键值对
function flattenTokens(tokens, prefix = "", result = {}, allTokens) {
  for (const [key, value] of Object.entries(tokens)) {
    const newKey = prefix ? `${prefix}-${key}` : key;

    if (value.$type && value.$value) {
      // 这是一个 token
      if (value.$type === "color") {
        result[newKey] = resolveColorReference(value.$value, allTokens);
      } else if (value.$type === "shadow") {
        result[newKey] = processShadowValue(value.$value);
      } else {
        result[newKey] = value.$value;
      }
    } else if (typeof value === "object") {
      // 这是一个嵌套对象
      flattenTokens(value, newKey, result, allTokens);
    }
  }

  return result;
}

// 处理 CSS 变量中的引用
function resolveCSSReferences(css, allTokens) {
  // 匹配 {xxx} 或 {xxx.yyy.zzz} 格式的引用
  return css.replace(/\{([^{}]+)\}/g, (match, reference) => {
    // 将点号分隔的引用转换为路径
    const parts = reference.split(".");

    // 从 allTokens 中查找引用的值
    let value = allTokens;
    for (const part of parts) {
      if (!value || !value[part]) {
        // 尝试使用连字符分隔的方式查找
        if (part.includes("-")) {
          const [parent, child] = part.split("-");
          if (value[parent] && value[parent][child]) {
            value = value[parent][child];
            continue;
          }
        }
        console.warn(`CSS 引用未找到: ${reference}`);
        return match; // 保持原样
      }
      value = value[part];
    }

    // 如果找到的是 token 对象，返回其 $value
    if (value && value.$value !== undefined) {
      // 如果 $value 本身也是引用，递归解析
      if (
        typeof value.$value === "string" &&
        value.$value.startsWith("{") &&
        value.$value.endsWith("}")
      ) {
        return resolveCSSReferences(value.$value, allTokens);
      }
      return value.$value;
    }

    // 如果找到的是 CSS 变量名，转换为 var(--xxx)
    if (reference.startsWith("--")) {
      return `var(${reference})`;
    }

    // 如果找到的是普通字符串
    if (typeof value === "string") {
      // 如果值本身也是引用，递归解析
      if (value.startsWith("{") && value.endsWith("}")) {
        return resolveCSSReferences(value, allTokens);
      }
      return value;
    }

    console.warn(`CSS 引用格式不正确: ${reference}`);
    return match; // 保持原样
  });
}

// 生成 CSS 变量
function generateCSSVariables(tokens) {
  let css = "";

  for (const [key, value] of Object.entries(tokens)) {
    css += `  --${key}: ${value};\n`;
  }

  return css;
}

// 生成主题颜色 CSS
function generateThemeColorCSS(manifest) {
  let css = "/* 主题色变量 */\n:root {\n";

  // 默认使用蓝色主题
  const blueThemeFile = manifest.collections.theme.modes["💙 Blue"][0];
  const blueTheme = readTokenFile(blueThemeFile);
  const allTokens = loadAllTokens(manifest);

  const flattenedTokens = flattenTokens(blueTheme, "", {}, allTokens);
  css += generateCSSVariables(flattenedTokens);

  // 添加状态颜色
  css += "\n  /* 状态颜色 - 这些颜色在所有主题中保持一致 */\n";

  // 从调色板中提取颜色
  const brandPaletteFile = manifest.collections.palette.modes.brand[0];
  const brandPalette = readTokenFile(brandPaletteFile);

  // 添加红色系列
  if (brandPalette.red) {
    for (const [shade, value] of Object.entries(brandPalette.red)) {
      if (value.$type === "color") {
        css += `  --red-${shade}: ${value.$value};\n`;
      }
    }
  }

  // 添加绿色系列
  if (brandPalette.green) {
    for (const [shade, value] of Object.entries(brandPalette.green)) {
      if (value.$type === "color") {
        css += `  --green-${shade}: ${value.$value};\n`;
      }
    }
  }

  // 添加黄色系列
  if (brandPalette.yellow) {
    for (const [shade, value] of Object.entries(brandPalette.yellow)) {
      if (value.$type === "color") {
        css += `  --yellow-${shade}: ${value.$value};\n`;
      }
    }
  }

  // 添加蓝色系列
  if (brandPalette.blue) {
    for (const [shade, value] of Object.entries(brandPalette.blue)) {
      if (value.$type === "color") {
        css += `  --blue-${shade}: ${value.$value};\n`;
      }
    }
  }

  // 添加天蓝色系列
  if (brandPalette.sky) {
    for (const [shade, value] of Object.entries(brandPalette.sky)) {
      if (value.$type === "color") {
        css += `  --sky-${shade}: ${value.$value};\n`;
      }
    }
  }

  // 添加紫色系列
  if (brandPalette.purple) {
    for (const [shade, value] of Object.entries(brandPalette.purple)) {
      if (value.$type === "color") {
        css += `  --purple-${shade}: ${value.$value};\n`;
      }
    }
  }

  // 添加橙色系列
  if (brandPalette.orange) {
    for (const [shade, value] of Object.entries(brandPalette.orange)) {
      if (value.$type === "color") {
        css += `  --orange-${shade}: ${value.$value};\n`;
      }
    }
  }

  // 添加透明色
  if (brandPalette.alpha) {
    css += "\n  /* 透明色 */\n";
    for (const colorName of ["blue", "purple", "orange", "sky"]) {
      if (brandPalette.alpha[colorName]) {
        for (const [alphaName, value] of Object.entries(
          brandPalette.alpha[colorName]
        )) {
          if (value.$type === "color") {
            css += `  --alpha-${colorName}-${alphaName}: ${value.$value};\n`;
          }
        }
      }
    }
  }

  css += "}\n\n";

  // 为每个主题颜色生成 CSS
  for (const [themeName, files] of Object.entries(
    manifest.collections.theme.modes
  )) {
    const themeFile = files[0];
    const theme = readTokenFile(themeFile);

    // 将 emoji 从主题名称中提取出来
    const themeKey = themeName.includes("💙")
      ? "blue"
      : themeName.includes("💜")
      ? "purple"
      : themeName.includes("🧡")
      ? "orange"
      : themeName.includes("🩵")
      ? "sky"
      : "blue";

    css += `/* ${themeName} */\n`;
    css += `[data-theme-color="${themeKey}"] {\n`;

    const flattenedTheme = flattenTokens(theme, "", {}, allTokens);
    css += generateCSSVariables(flattenedTheme);

    css += "}\n\n";
  }

  return css;
}

// 生成亮色模式 CSS
function generateLightModeCSS(manifest) {
  let css = "/* 亮色模式变量 */\n:root {\n";

  const lightTokenFile = manifest.collections.token.modes.light[0];
  const lightTokens = readTokenFile(lightTokenFile);
  const allTokens = loadAllTokens(manifest);

  // 使用 flattenTokens 处理所有 token 类型
  const flattenedTokens = flattenTokens(lightTokens, "", {}, allTokens);
  css += generateCSSVariables(flattenedTokens);

  css += "}\n";
  return css;
}

// 生成暗色模式 CSS
function generateDarkModeCSS(manifest) {
  let css = '/* 暗色模式变量 */\n[data-theme-mode="dark"] {\n';

  const darkTokenFile = manifest.collections.token.modes.dark[0];
  const darkTokens = readTokenFile(darkTokenFile);
  const allTokens = loadAllTokens(manifest);

  // 使用 flattenTokens 处理所有 token 类型
  const flattenedTokens = flattenTokens(darkTokens, "", {}, allTokens);
  css += generateCSSVariables(flattenedTokens);

  css += "}\n";
  return css;
}

// 生成效果样式 CSS
function generateEffectStylesCSS(manifest) {
  let css = "/* 效果样式变量 */\n:root {\n";

  // 读取效果样式 token 文件
  const effectStylesFile = "effect.styles.tokens.json";
  const effectStyles = readTokenFile(effectStylesFile);
  const allTokens = loadAllTokens(manifest);

  // 使用 flattenTokens 处理所有效果样式
  const flattenedTokens = flattenTokens(effectStyles, "effect", {}, allTokens);
  css += generateCSSVariables(flattenedTokens);

  css += "}\n";
  return css;
}

// 生成尺寸集合 CSS
function generateSizeSetCSS(manifest) {
  let css = "/* 尺寸集合变量 */\n:root {\n";

  // 读取所有尺寸集合文件
  const sizeSetFiles = fs
    .readdirSync(DESIGN_TOKENS_PATH)
    .filter((file) => file.startsWith("set.") && file.endsWith(".tokens.json"));

  const allTokens = loadAllTokens(manifest);

  for (const file of sizeSetFiles) {
    const setName = file.replace("set.", "").replace(".tokens.json", "");
    const setTokens = readTokenFile(file);

    // 使用 flattenTokens 处理所有尺寸集合
    const flattenedTokens = flattenTokens(
      setTokens,
      `set-${setName}`,
      {},
      allTokens
    );
    css += generateCSSVariables(flattenedTokens);
    css += "\n";
  }

  css += "}\n";
  return css;
}

// 加载所有 token 以便解析引用
function loadAllTokens(manifest) {
  const allTokens = {};

  // 加载调色板 token
  for (const paletteType of Object.keys(manifest.collections.palette.modes)) {
    const files = manifest.collections.palette.modes[paletteType];
    for (const file of files) {
      const tokens = readTokenFile(file);
      Object.assign(allTokens, tokens);
    }
  }

  // 加载主题 token
  for (const themeName of Object.keys(manifest.collections.theme.modes)) {
    const files = manifest.collections.theme.modes[themeName];
    for (const file of files) {
      const tokens = readTokenFile(file);
      Object.assign(allTokens, tokens);
    }
  }

  // 加载模式特定的 token（亮色/暗色）
  for (const modeName of Object.keys(manifest.collections.token.modes)) {
    const files = manifest.collections.token.modes[modeName];
    for (const file of files) {
      const tokens = readTokenFile(file);
      Object.assign(allTokens, tokens);
    }
  }

  // 加载效果样式 token
  if (manifest.collections.effect?.modes) {
    for (const effectName of Object.keys(manifest.collections.effect.modes)) {
      const files = manifest.collections.effect.modes[effectName];
      for (const file of files) {
        const tokens = readTokenFile(file);
        Object.assign(allTokens, tokens);
      }
    }
  }

  return allTokens;
}

// 生成完整的 CSS 文件
function generateCSS() {
  const manifest = readManifest();

  let css = "";

  // 生成主题颜色 CSS
  css += generateThemeColorCSS(manifest);

  // 生成亮色模式 CSS
  css += generateLightModeCSS(manifest);

  // 生成暗色模式 CSS
  css += generateDarkModeCSS(manifest);

  // 生成调色板 CSS
  css += generatePaletteCSS(manifest);

  // 生成效果样式 CSS
  css += generateEffectStylesCSS(manifest);

  // 生成尺寸集合 CSS
  css += generateSizeSetCSS(manifest);

  // 解析 CSS 中的引用
  css = resolveCSSReferences(css, loadAllTokens(manifest));

  return css;
}

// 生成调色板 CSS
function generatePaletteCSS(manifest) {
  let css = "";

  // 品牌色
  const brandPaletteFile = manifest.collections.palette.modes.brand[0];
  const brandPalette = readTokenFile(brandPaletteFile);

  css += "/* 品牌色 */\n";
  css += '[data-palette-type="brand"] {\n';

  // 中性色
  if (brandPalette.neutral) {
    for (const [shade, value] of Object.entries(brandPalette.neutral)) {
      if (value.$type === "color") {
        css += `  --neutral-${shade}: ${value.$value};\n`;
      }
    }
  }

  css += "\n  /* 其他品牌色... */\n";
  css += "}\n\n";

  // 中性色
  const neutralPaletteFile = manifest.collections.palette.modes.neutral[0];
  const neutralPalette = readTokenFile(neutralPaletteFile);

  css += "/* 中性色 */\n";
  css += '[data-palette-type="neutral"] {\n';

  // 中性色
  if (neutralPalette.neutral) {
    for (const [shade, value] of Object.entries(neutralPalette.neutral)) {
      if (value.$type === "color") {
        css += `  --neutral-${shade}: ${value.$value};\n`;
      }
    }
  }

  css += "\n  /* 其他中性色... */\n";
  css += "}\n";

  return css;
}

// 将生成的 CSS 写入文件
function writeCSS(css) {
  fs.writeFileSync(OUTPUT_PATH, css, "utf8");
  console.log(`CSS 文件已生成: ${OUTPUT_PATH}`);
}

// 主函数
function main() {
  try {
    const css = generateCSS();
    writeCSS(css);
  } catch (error) {
    console.error("生成 CSS 文件时出错:", error);
  }
}

// 导出函数以便在其他地方使用
export { generateCSS, writeCSS, main };
