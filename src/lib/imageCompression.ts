
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const TARGET_IMAGE_SIZE = 1.5 * 1024 * 1024; // Aim for 1.5 MB

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export interface ImageCompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export { formatFileSize };

export function validateAttachment(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File size exceeds the 5 MB limit. Selected file: ${formatFileSize(file.size)}.`
    );
  }

  if (file.size === 0) {
    throw new Error("The selected file is empty.");
  }

  if (
    file.type !== "application/pdf" &&
    !ALLOWED_IMAGE_TYPES.includes(file.type)
  ) {
    throw new Error(
      "Unsupported file format. Only PDF, JPG, PNG and WebP files are allowed."
    );
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read the selected image."));
    };

    image.src = objectUrl;
  });
}

function canvasToWebP(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== "image/webp") {
          reject(new Error("WebP conversion is not supported by this browser."));
          return;
        }

        resolve(blob);
      },
      "image/webp",
      quality
    );
  });
}

export async function compressImage(
  originalFile: File
): Promise<ImageCompressionResult> {
  // Validate every attachment before processing.
  validateAttachment(originalFile);

  // PDFs are uploaded unchanged.
  if (originalFile.type === "application/pdf") {
    return {
      file: originalFile,
      originalSize: originalFile.size,
      compressedSize: originalFile.size,
      wasCompressed: false,
    };
  }

  try {
    const image = await loadImage(originalFile);

    // Resize large images while maintaining aspect ratio.
    const maxDimension = 1600;

    const scale = Math.min(
      1,
      maxDimension / image.width,
      maxDimension / image.height
    );

    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Unable to process the selected image.");
    }

    context.drawImage(image, 0, 0, width, height);

    // Try progressively stronger compression until the target is reached.
    const qualityLevels = [0.72, 0.62, 0.52, 0.42, 0.32];

    let compressedBlob: Blob | null = null;

    for (const quality of qualityLevels) {
      compressedBlob = await canvasToWebP(canvas, quality);

      if (compressedBlob.size <= TARGET_IMAGE_SIZE) {
        break;
      }
    }

    if (!compressedBlob) {
      throw new Error("Image compression failed.");
    }

    // Do not upload an image exceeding the overall file-size limit.
    if (compressedBlob.size > MAX_FILE_SIZE) {
      throw new Error(
        "The image could not be compressed below the 5 MB upload limit."
      );
    }

    const originalName = originalFile.name.replace(/\.[^/.]+$/, "");
    const webpFile = new File(
      [compressedBlob],
      `${originalName || "image"}.webp`,
      {
        type: "image/webp",
        lastModified: Date.now(),
      }
    );

    return {
      file: webpFile,
      originalSize: originalFile.size,
      compressedSize: webpFile.size,
      wasCompressed: true,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unable to compress this image.");
  }
}
