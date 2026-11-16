export function normalizeAzDigits(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) {
    return `994${digits.slice(1)}`;
  }
  if (digits.length === 9) {
    return `994${digits}`;
  }
  return digits;
}

export function buildWhatsAppUrl(phone: string, text: string): string {
  const digits = normalizeAzDigits(phone);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function buildTelUrl(phone: string): string {
  const digits = normalizeAzDigits(phone);
  return `tel:+${digits}`;
}

export function formatTimeAgoAz(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 45) return 'indicə';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} dəq əvvəl`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saat əvvəl`;
  const days = Math.floor(hours / 24);
  return `${days} gün əvvəl`;
}

export async function compressImageFile(file: File, maxSize = 1080, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Şəkil oxunmadı'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Şəkil formatı dəstəklənmir'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width >= height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
