import { formatCents } from '@casa/core/money';
import { amount, colors, numeric, radius, space, typeScale } from '@casa/tokens';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const FIGURES = [
  { label: 'Income this month', cents: 842_500, color: colors.positive, sign: 'always' },
  { label: 'Groceries left, 88% spent', cents: 6_150, color: colors.caution, sign: 'auto' },
  { label: 'Dining out, over budget', cents: -12_840, color: colors.negative, sign: 'auto' },
] as const;

export default function MoneyScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        {FIGURES.map(({ label, cents, color, sign }, index) => (
          <View key={label} style={[styles.row, index > 0 && styles.divider]}>
            <Text style={styles.label}>{label}</Text>
            <Text style={[styles.amount, { color }]}>
              {formatCents(cents, { signDisplay: sign })}
            </Text>
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
    padding: space[4],
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
  },
  row: {
    padding: space[4],
    gap: space[1],
  },
  divider: {
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  label: {
    ...typeScale.sm,
    ...numeric,
    color: colors.inkMuted,
  },
  amount: amount['3xl'],
});
