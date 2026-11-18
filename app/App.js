import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StatusBar as RNStatusBar,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

// Settes i .env (se README): EXPO_PUBLIC_API_URL og EXPO_PUBLIC_APP_TOKEN
const API_URL = process.env.EXPO_PUBLIC_API_URL;
const APP_TOKEN = process.env.EXPO_PUBLIC_APP_TOKEN;

const BRANDS = ['Bambu Lab', 'Prusa', 'Creality', 'Elegoo', 'Anycubic', 'Qidi', 'Sovol', 'Voron / Klipper', 'Annen'];
const SLICERS = ['Bambu Studio', 'OrcaSlicer', 'PrusaSlicer', 'Cura', 'Creality Print', 'Annen'];
const FILAMENTS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'Nylon / PA', 'PC', 'Karbonfiber-blanding', 'Annet'];
const NOZZLES = ['0.4 mm', '0.2 mm', '0.6 mm', '0.8 mm'];
const PLATES = ['Textured PEI', 'Smooth PEI', 'Glass', 'Cool Plate / Supertack', 'Annet'];
// Foreslått slicer når man velger merke (kan endres etterpå)
const DEFAULT_SLICER = {
  'Bambu Lab': 'Bambu Studio',
  Prusa: 'PrusaSlicer',
  Creality: 'Creality Print',
  Qidi: 'OrcaSlicer',
  'Voron / Klipper': 'OrcaSlicer',
};

const MAX_IMAGE_WIDTH = 1280;
const REQUEST_TIMEOUT_MS = 60000;

export default function App() {
  const [image, setImage] = useState(null); // { uri, base64 }
  const [brand, setBrand] = useState('Bambu Lab');
  const [model, setModel] = useState('');
  const [slicer, setSlicer] = useState('Bambu Studio');
  const [filament, setFilament] = useState('PLA');
  const [nozzle, setNozzle] = useState('0.4 mm');
  const [plate, setPlate] = useState('Textured PEI');
  const [problem, setProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const pickImage = async (useCamera) => {
    setErrorMsg(null);
    const permission = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setErrorMsg('Appen trenger tilgang til kamera eller bilder.');
      return;
    }

    const options = { mediaTypes: ['images'], quality: 1 };
    const pickerResult = useCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (pickerResult.canceled || !pickerResult.assets?.length) return;

    const asset = pickerResult.assets[0];
    try {
      // Skaler ned og komprimer slik at opplastingen holder seg godt under grensa til serveren
      const actions =
        asset.width && asset.width > MAX_IMAGE_WIDTH
          ? [{ resize: { width: MAX_IMAGE_WIDTH } }]
          : [];
      const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      setImage({ uri: out.uri, base64: out.base64 });
      setResult(null);
    } catch (e) {
      setErrorMsg('Kunne ikke behandle bildet: ' + (e.message || 'ukjent feil'));
    }
  };

  const analyzePrint = async () => {
    setErrorMsg(null);
    setResult(null);

    if (!problem.trim() && !image) {
      setErrorMsg('Ta et bilde eller skriv hva som skjedde med utskriften først.');
      return;
    }
    if (!API_URL || !APP_TOKEN) {
      setErrorMsg('Appen mangler serveroppsett (EXPO_PUBLIC_API_URL / EXPO_PUBLIC_APP_TOKEN).');
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-token': APP_TOKEN,
        },
        body: JSON.stringify({
          brand,
          model: model.trim(),
          slicer,
          filament,
          nozzle,
          plate,
          problem: problem.trim(),
          image: image ? { mimeType: 'image/jpeg', data: image.base64 } : null,
        }),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errText = data.error ? data.error : 'Serveren svarte med feil, kode ' + response.status;
        throw new Error(errText);
      }
      if (!data.text) throw new Error('Fikk ikke noe svar fra AI-en.');

      setResult(data.text);
    } catch (error) {
      const msg =
        error.name === 'AbortError'
          ? 'Tidsavbrudd – AI-en brukte for lang tid. Prøv igjen.'
          : error.message || 'Kunne ikke koble til AI.';
      setErrorMsg('Feil: ' + msg);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  const renderSelector = (title, options, selected, onSelect) => (
    <View style={styles.section}>
      <Text style={styles.label}>{title}</Text>
      <View style={styles.chipRow}>
        {options.map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.chip, selected === item && styles.chipActive]}
            onPress={() => onSelect(item)}
          >
            <Text style={[styles.chipText, selected === item && styles.chipTextActive]}>
              {item}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>PrintDoctor</Text>
        <Text style={styles.subHeader}>AI-hjelp for 3D-utskrifter – alle printere og slicere</Text>

        <View style={styles.imageBox}>
          {image ? (
            <>
              <Image source={{ uri: image.uri }} style={styles.previewImage} resizeMode="contain" />
              <TouchableOpacity onPress={() => setImage(null)}>
                <Text style={styles.removeText}>Fjern bilde</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.placeholderText}>Ingen bilde valgt ennå</Text>
          )}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.secButton} onPress={() => pickImage(true)}>
              <Text style={styles.secButtonText}>Ta bilde</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secButton} onPress={() => pickImage(false)}>
              <Text style={styles.secButtonText}>Velg bilde</Text>
            </TouchableOpacity>
          </View>
        </View>

        {renderSelector('Printer', BRANDS, brand, (b) => {
          setBrand(b);
          if (DEFAULT_SLICER[b]) setSlicer(DEFAULT_SLICER[b]);
        })}
        <View style={styles.section}>
          <TextInput
            style={[styles.input, styles.inputSmall]}
            placeholder="Modell (valgfritt), f.eks. P1S, Ender-3 Pro, MK4"
            placeholderTextColor="#777"
            maxLength={60}
            value={model}
            onChangeText={setModel}
          />
        </View>
        {renderSelector('Slicer', SLICERS, slicer, setSlicer)}
        {renderSelector('Filament', FILAMENTS, filament, setFilament)}
        {renderSelector('Dysestørrelse', NOZZLES, nozzle, setNozzle)}
        {renderSelector('Byggeplate', PLATES, plate, setPlate)}

        <View style={styles.section}>
          <Text style={styles.label}>Hva skjedde, eller hva skal du printe?</Text>
          <TextInput
            style={styles.input}
            placeholder="F.eks. Hjørnene løfter seg, stringing..."
            placeholderTextColor="#777"
            multiline
            maxLength={1000}
            value={problem}
            onChangeText={setProblem}
          />
        </View>

        <TouchableOpacity
          style={[styles.mainButton, loading && styles.disabledButton]}
          onPress={analyzePrint}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.mainButtonText}>Analyser med AI</Text>
          )}
        </TouchableOpacity>

        {errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {result && (
          <View style={styles.resultBox}>
            <Text style={styles.resultTitle}>Anbefalte tiltak og innstillinger:</Text>
            <Text style={styles.resultText} selectable>
              {result}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight || 24 : 44,
  },
  scroll: { padding: 20, paddingBottom: 50 },
  header: { fontSize: 28, fontWeight: 'bold', color: '#00AE42', marginTop: 15 },
  subHeader: { fontSize: 14, color: '#AAA', marginBottom: 20 },
  imageBox: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  previewImage: { width: '100%', height: 220, borderRadius: 8, marginBottom: 8 },
  removeText: { color: '#FF7777', marginBottom: 12, fontSize: 13 },
  placeholderText: { color: '#777', marginVertical: 40 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  secButton: {
    backgroundColor: '#2C2C2C',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  secButtonText: { color: '#FFF', fontWeight: '600' },
  section: { marginBottom: 18 },
  label: { color: '#EEE', fontSize: 15, fontWeight: '600', marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#1E1E1E',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  chipActive: { backgroundColor: '#00AE42', borderColor: '#00AE42' },
  chipText: { color: '#CCC', fontSize: 13 },
  chipTextActive: { color: '#000', fontWeight: 'bold' },
  input: {
    backgroundColor: '#1E1E1E',
    color: '#FFF',
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#333',
  },
  mainButton: {
    backgroundColor: '#00AE42',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  inputSmall: { minHeight: 0, paddingVertical: 10 },
  disabledButton: { opacity: 0.6 },
  mainButtonText: { color: '#000', fontSize: 16, fontWeight: 'bold' },
  errorBox: {
    backgroundColor: '#3A1818',
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#FF5555',
  },
  errorText: { color: '#FF9999', fontSize: 13 },
  resultBox: {
    backgroundColor: '#1A241E',
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#00AE42',
  },
  resultTitle: { color: '#00AE42', fontWeight: 'bold', fontSize: 16, marginBottom: 10 },
  resultText: { color: '#EFEFEF', fontSize: 14, lineHeight: 22 },
});
