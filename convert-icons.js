import sharp from 'sharp';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function convertSvgToPng() {
  const sizes = [16, 48, 128];
  
  try {
    // 確保輸出目錄存在
    await fs.mkdir(join(__dirname, 'icons'), { recursive: true });
    
    // 轉換每個尺寸的圖示
    for (const size of sizes) {
      const svgPath = join(__dirname, 'icons', `icon${size}.svg`);
      const pngPath = join(__dirname, 'icons', `icon${size}.png`);
      
      // 讀取SVG文件
      const svgBuffer = await fs.readFile(svgPath);
      
      // 轉換為PNG
      await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toFile(pngPath);
      
      console.log(`成功轉換 icon${size}.svg 為 PNG 格式`);
    }
    
    console.log('所有圖示轉換完成！');
  } catch (error) {
    console.error('轉換過程中發生錯誤:', error);
  }
}

convertSvgToPng();