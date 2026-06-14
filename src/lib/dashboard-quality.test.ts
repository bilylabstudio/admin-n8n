import { describe, expect, it } from 'vitest';
import {
  buildQualityBySendDay,
  editIntensity,
  hasMeaningfulRiskFlag,
  summarizeLabelingQuality,
  summarizeSendQuality,
  summarizeSentimentQuality
} from './dashboard-quality';

describe('editIntensity', () => {
  it('returns 0 for identical normalized replies', () => {
    expect(editIntensity(' Hola   Maria ', 'Hola Maria')).toBe(0);
  });

  it('returns a small ratio for light edits', () => {
    const ratio = editIntensity('Hola Maria', 'Hola Maria, gracias');
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(0.6);
  });

  it('returns 1 for totally different empty-to-full edits', () => {
    expect(editIntensity('', 'Respuesta nueva')).toBe(1);
  });
});

describe('send quality', () => {
  it('summarizes sent without edit, edited rate, and edit intensity', () => {
    const summary = summarizeSendQuality([
      {
        status: 'approved_sent',
        sentAt: new Date('2026-06-12T10:00:00.000Z'),
        aiReply: 'Hola Maria',
        finalReply: 'Hola Maria'
      },
      {
        status: 'edited_sent',
        sentAt: new Date('2026-06-12T11:00:00.000Z'),
        aiReply: 'Hola Maria',
        finalReply: 'Hola Maria, te ayudo con tu pedido.'
      },
      {
        status: 'discarded',
        sentAt: null,
        aiReply: 'No cuenta',
        finalReply: null
      }
    ]);

    expect(summary.sentTotal).toBe(2);
    expect(summary.approvedSent).toBe(1);
    expect(summary.editedSent).toBe(1);
    expect(summary.sentWithoutEditRate).toBe(50);
    expect(summary.editedBeforeSendRate).toBe(50);
    expect(summary.avgEditIntensityEdited).toBeGreaterThan(0);
    expect(summary.avgEditIntensityAll).toBeGreaterThan(0);
    expect(summary.avgEditIntensityAll).toBeLessThan(summary.avgEditIntensityEdited);
  });

  it('builds a daily series by sentAt and fills empty days', () => {
    const rows = buildQualityBySendDay(
      [
        {
          status: 'approved_sent',
          sentAt: new Date('2026-06-10T10:00:00.000Z'),
          aiReply: 'Respuesta',
          finalReply: 'Respuesta'
        },
        {
          status: 'edited_sent',
          sentAt: new Date('2026-06-12T10:00:00.000Z'),
          aiReply: 'Respuesta',
          finalReply: 'Respuesta editada'
        }
      ],
      new Date('2026-06-10T00:00:00.000Z'),
      3
    );

    expect(rows).toEqual([
      {
        date: '2026-06-10',
        sentTotal: 1,
        approvedSent: 1,
        editedSent: 0,
        sentWithoutEditRate: 100,
        editedBeforeSendRate: 0,
        avgEditIntensity: 0
      },
      {
        date: '2026-06-11',
        sentTotal: 0,
        approvedSent: 0,
        editedSent: 0,
        sentWithoutEditRate: 0,
        editedBeforeSendRate: 0,
        avgEditIntensity: 0
      },
      {
        date: '2026-06-12',
        sentTotal: 1,
        approvedSent: 0,
        editedSent: 1,
        sentWithoutEditRate: 0,
        editedBeforeSendRate: 100,
        avgEditIntensity: expect.any(Number)
      }
    ]);
    expect(rows[2].avgEditIntensity).toBeGreaterThan(0);
  });
});

describe('risk and coverage quality', () => {
  it('ignores empty risk flags', () => {
    expect(hasMeaningfulRiskFlag(null)).toBe(false);
    expect(hasMeaningfulRiskFlag('')).toBe(false);
    expect(hasMeaningfulRiskFlag('   ')).toBe(false);
    expect(hasMeaningfulRiskFlag('refund_dispute')).toBe(true);
  });

  it('separates closed labels, new unlabeled, and historical unclassified tickets', () => {
    const summary = summarizeLabelingQuality([
      {
        routedTemplateId: 'sub_baja_generica',
        routeSource: 'canonical_router',
        caseReasoningJson: { family: 'suscripcion' }
      },
      {
        routedTemplateId: null,
        routeSource: 'canonical_router',
        caseReasoningJson: { family: 'producto' }
      },
      {
        routedTemplateId: null,
        routeSource: null,
        caseReasoningJson: null
      }
    ]);

    expect(summary.eligibleForRouting).toBe(2);
    expect(summary.closedLabelCount).toBe(1);
    expect(summary.newUnlabeledCount).toBe(1);
    expect(summary.historicalUnclassifiedCount).toBe(1);
    expect(summary.closedLabelRate).toBe(50);
  });

  it('calculates sentiment coverage only over eligible tickets', () => {
    const summary = summarizeSentimentQuality([
      {
        sentiment: 'molesto',
        sentimentSource: 'live_classifier',
        routeSource: 'canonical_router',
        caseReasoningJson: { family: 'suscripcion' }
      },
      {
        sentiment: null,
        sentimentSource: null,
        routeSource: 'canonical_router',
        caseReasoningJson: { family: 'producto' }
      },
      {
        sentiment: null,
        sentimentSource: null,
        routeSource: null,
        caseReasoningJson: null
      }
    ]);

    expect(summary.eligibleForSentiment).toBe(2);
    expect(summary.sentimentAnalyzed).toBe(1);
    expect(summary.sentimentCoverage).toBe(50);
  });
});
