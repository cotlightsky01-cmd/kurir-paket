export interface ExtractedLabelData {
  name: string;
  phone: string;
  address: string;
  cod_amount: string;
  package_count: string;
  error?: string;
}

export async function extractBatchData(imageData: { data: string; mimeType: string }[]): Promise<ExtractedLabelData[]> {
  try {
    const res = await fetch('/api/extract-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageData }),
    });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const json = await res.json();
    if (json.results && Array.isArray(json.results)) {
      return json.results;
    }
    throw new Error('Invalid response structure from backend');
  } catch (err: any) {
    console.error('Error sending extract request to backend:', err);
    return imageData.map(() => ({
      name: '',
      phone: '',
      address: '',
      cod_amount: 'NO COD',
      package_count: '1',
      error: err?.message || 'Server connection error'
    }));
  }
}
