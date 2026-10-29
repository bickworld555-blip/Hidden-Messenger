import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

function messageFromError(error: unknown) {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "message" in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  if (error instanceof Error) return error.message;
  return "Could not complete phone verification. Please try again.";
}

function formatPhone(phone: string) {
  const local = phone.replace(/^880/, "");
  return `+880 ${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
}

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isNativeAuthAvailable, requestOtp, verifyOtp } = useAuth();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [localNumber, setLocalNumber] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const sendCode = async (phone: string) => {
    setError("");
    setBusy(true);
    try {
      const result = await requestOtp(phone);
      setVerifiedPhone(result.phone);
      setStep("code");
      setCode("");
      setCountdown(result.retryAfterSeconds);
    } catch (requestError) {
      setError(messageFromError(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleSendCode = () => {
    const digits = localNumber.replace(/\D/g, "");
    if (!/^1[3-9]\d{8}$/.test(digits)) {
      setError("Enter a valid 10-digit Bangladesh mobile number after +880.");
      return;
    }
    void sendCode(`+880${digits}`);
  };

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your SMS.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await verifyOtp(verifiedPhone, code);
    } catch (verifyError) {
      setError(messageFromError(verifyError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 28) + 24, paddingBottom: Math.max(insets.bottom, 24) + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={[styles.brandMark, { backgroundColor: colors.accent }]}>
            <Feather name="message-circle" size={25} color={colors.primary} />
          </View>
          <Text style={[styles.brand, { color: colors.foreground }]}>Hidden Messenger</Text>
          <Text style={[styles.tagline, { color: colors.mutedForeground }]}>Private conversations, kept simple</Text>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.stepRow}>
              <Text style={[styles.eyebrow, { color: colors.primary }]}>
                {step === "phone" ? "PHONE VERIFICATION" : "VERIFY YOUR CODE"}
              </Text>
              <Text style={[styles.stepCount, { color: colors.mutedForeground }]}>
                {step === "phone" ? "1 of 2" : "2 of 2"}
              </Text>
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {step === "phone" ? "Sign in with your number" : "Enter your verification code"}
            </Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              {step === "phone"
                ? "We’ll send a one-time code to your Bangladesh mobile number."
                : `The six-digit code was sent to ${formatPhone(verifiedPhone)}.`}
            </Text>

            {step === "phone" ? (
              <View style={[styles.phoneInput, { borderColor: colors.input, backgroundColor: colors.background }]}>
                <View style={[styles.countryPrefix, { borderRightColor: colors.border }]}>
                  <Text style={[styles.countryLabel, { color: colors.foreground }]}>BD</Text>
                  <Text style={[styles.countryCode, { color: colors.mutedForeground }]}>+880</Text>
                </View>
                <TextInput
                  value={localNumber}
                  onChangeText={(value) => {
                    setLocalNumber(value.replace(/[^\d ]/g, "").slice(0, 13));
                    setError("");
                  }}
                  placeholder="17 1234 5678"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  maxLength={13}
                  editable={!busy}
                  style={[styles.phoneField, { color: colors.foreground }]}
                  accessibilityLabel="Bangladesh mobile number"
                />
              </View>
            ) : (
              <>
                <TextInput
                  value={code}
                  onChangeText={(value) => {
                    setCode(value.replace(/\D/g, "").slice(0, 6));
                    setError("");
                  }}
                  placeholder="000000"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  maxLength={6}
                  editable={!busy && isNativeAuthAvailable}
                  style={[
                    styles.codeField,
                    { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background },
                  ]}
                  accessibilityLabel="Six-digit verification code"
                />
                <View style={styles.codeActions}>
                  <Pressable
                    onPress={() => {
                      setStep("phone");
                      setError("");
                      setCode("");
                    }}
                    disabled={busy}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.link, { color: colors.primary }]}>Change number</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void sendCode(verifiedPhone)}
                    disabled={busy || countdown > 0 || !isNativeAuthAvailable}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.link,
                        { color: busy || countdown > 0 ? colors.mutedForeground : colors.primary },
                      ]}
                    >
                      {countdown > 0 ? `Resend in ${countdown}s` : "Resend code"}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: `${colors.destructive}12` }]}>
                <Feather name="alert-circle" size={15} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
              </View>
            ) : null}

            {!isNativeAuthAvailable ? (
              <View style={[styles.notice, { backgroundColor: colors.secondary }]}>
                <Feather name="smartphone" size={16} color={colors.primary} />
                <Text style={[styles.noticeText, { color: colors.secondaryForeground }]}>
                  Enter a number to preview this screen. OTP sign-in stays disabled here because browsers cannot store an auth token safely.
                </Text>
              </View>
            ) : null}

            <Pressable
              onPress={step === "phone" ? handleSendCode : handleVerify}
              disabled={busy || !isNativeAuthAvailable}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.primary, opacity: busy || !isNativeAuthAvailable ? 0.55 : pressed ? 0.86 : 1 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                    {step === "phone" ? "Send verification code" : "Verify and continue"}
                  </Text>
                  <Feather name="arrow-right" size={17} color={colors.primaryForeground} />
                </>
              )}
            </Pressable>
          </View>

          <View style={styles.privacyNote}>
            <Feather name="lock" size={13} color={colors.primary} />
            <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
              Your code is verified by Hidden Messenger’s API and is never stored in the app. Chat sending remains locked until E2EE is reviewed.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 22 },
  content: { width: "100%", maxWidth: 430, alignSelf: "center" },
  brandMark: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  brand: { marginTop: 13, textAlign: "center", fontSize: 25, fontWeight: "700", letterSpacing: -0.5 },
  tagline: { marginTop: 5, textAlign: "center", fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 22, padding: 21, marginTop: 30 },
  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 1.2 },
  stepCount: { fontSize: 11, fontWeight: "600" },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700", marginTop: 16 },
  description: { fontSize: 13, lineHeight: 19, marginTop: 7, marginBottom: 22 },
  phoneInput: { minHeight: 58, borderWidth: 1, borderRadius: 14, flexDirection: "row", alignItems: "center", paddingHorizontal: 13 },
  countryPrefix: { height: 34, borderRightWidth: 1, paddingRight: 12, marginRight: 12, justifyContent: "center" },
  countryLabel: { fontSize: 12, fontWeight: "700" },
  countryCode: { fontSize: 10, marginTop: 1 },
  phoneField: { flex: 1, minHeight: 52, fontSize: 16, letterSpacing: 0.2 },
  codeField: { height: 60, borderWidth: 1, borderRadius: 14, textAlign: "center", fontSize: 24, fontWeight: "700", letterSpacing: 10 },
  codeActions: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  link: { fontSize: 12, fontWeight: "600" },
  errorBox: { marginTop: 15, borderRadius: 12, padding: 11, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17 },
  notice: { marginTop: 15, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 9 },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 16 },
  primaryButton: { minHeight: 52, borderRadius: 14, paddingHorizontal: 16, marginTop: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  primaryButtonText: { fontSize: 14, fontWeight: "700" },
  privacyNote: { marginTop: 19, flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 7, paddingHorizontal: 6 },
  privacyText: { maxWidth: 330, textAlign: "center", fontSize: 10.5, lineHeight: 15 },
});
