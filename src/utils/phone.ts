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
  const ts = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(ts)) return 'indicə';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
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
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Şəkil formatı dəstəklənmir'));
    };
    img.onload = () => {
      try {
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
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Canvas yaradılmadı'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        URL.revokeObjectURL(objectUrl);
        resolve(dataUrl);
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };
    img.src = objectUrl;
  });
}
