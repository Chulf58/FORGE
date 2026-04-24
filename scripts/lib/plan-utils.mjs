export function extractActiveFeatureSection(planContent) {
  const lines = planContent.split('\n');
  let featureStart = -1;
  let featureEnd = lines.length;
  let featureName = 'unknown';

  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^### Feature:/.test(lines[i])) {
      const section = lines.slice(i, featureEnd);
      if (section.some(l => /^- \[ \]/.test(l))) {
        featureStart = i;
        featureName = lines[i].replace(/^### Feature:\s*/, '').trim();
        break;
      }
      featureEnd = i;
    }
  }

  if (featureStart === -1) return { lines: [], featureName };
  return { lines: lines.slice(featureStart, featureEnd), featureName };
}
