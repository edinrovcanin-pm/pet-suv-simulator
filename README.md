# PET/CT SUV — simulator vremena uptake-a

Web aplikacija za simulaciju ¹⁸F-FDG PET/CT snimaka i SUV vrijednosti pri
**različitim vremenima uptake-a**. Učitaš DICOM PET snimke pacijenta koji je
snimljen na standardnih ~60 min nakon injekcije, a alat procjenjuje kako bi
izgledali SUV i kvalitet slike na **kraćim i dužim** vremenima — i predlaže
**optimalno vrijeme uptake-a** za detektabilnost lezije i tačnu SUV kvantifikaciju.

> ⚠️ Edukativno-istraživački alat. **Nije za kliničku dijagnostiku.**

## Šta radi

- **Baza pacijenata** — DICOM PET studije se čuvaju lokalno u browseru (IndexedDB).
  Piksel podaci i PHI se **ne šalju na server** (Vercel samo servira statičku aplikaciju).
- **DICOM parsiranje** (`dicom-parser`) — čita PET metapodatke i računa **SUVbw** po QIBA standardu.
- **Simulacija** — projektuje SUV mapu i ROI vrijednosti na proizvoljno vrijeme uptake-a.
- **Analiza** — SUV(t), TBR(t), šum/broj događaja(t) i **CNR(t)** krivulje; automatski nalazi optimalno vrijeme.
- **Demo fantom** — sintetički whole-body FDG fantom da alat radi i bez pravih DICOM snimaka.

## Naučna osnova modela

Dva fizikalno različita efekta se modeliraju **odvojeno** (ključna arhitektura):

### 1. Biologija → mijenja decay-korigovani SUV

SUV je decay-korigovan, pa promjene s vremenom odražavaju **pravu biologiju**
(nakupljanje/ispiranje traser), ne fizički raspad. Power-law model:

```
SUV(t) = SUV(ref) · (t / ref)^a
```

Retencioni eksponent `a` po tkivu (iz dual-time-point i dinamičke PET literature):

| Tkivo | `a` | SUV₁₂₀/SUV₆₀ | Ponašanje |
|---|---|---|---|
| Tumor (malignitet) | **+0.25** | ×1.19 (+19%) | ireverzibilno nakupljanje (k4≈0) |
| Upala | +0.28 | ×1.23 | raste, slično tumoru |
| Mišić | ~0 | ~flat | približno konstantno |
| Jetra | −0.10 | ×0.93 (−7%) | blago ispiranje |
| Krvni pool (medijastinum) | −0.15 | ×0.90 (−10%) | renalni klirens |

Rezultat: tumor raste dok se pozadina ispire → **TBR raste** s dužim uptake-om.

### 2. Raspad → mijenja šum na slici

F-18 se raspada (T½ = **109.77 min**, λ = ln2/109.77). Za **fiksno trajanje snimanja**,
na dužem uptake-u se prikupi manje događaja:

```
rel. događaji(t) = exp(−λ·(t − ref))
rel. šum(t)      ∝ 1/√događaji = exp(+λ·(t − ref)/2)
```

(60→120 min: događaji ×0.685, šum +21%.) Postoji i scenarij *konstantnog broja događaja*
(produženo snimanje) gdje šum ostaje ~konstantan.

### 3. Detektabilnost i optimalno vrijeme

```
CNR(t) = (SUV_lezija(t) − SUV_pozadina(t)) / (σ_pozadina · rel.šum(t))
```

Kontrast raste, šum raste → **CNR ima maksimum**. To vrijeme = procijenjeno optimalno
vrijeme uptake-a. Za većinu onkoloških lezija optimum je u rasponu ~90–120 min
(pomjera se ranije kako raste k4).

### SUVbw iz DICOM-a (QIBA)

```
decay_time   = AcquisitionTime − RadiopharmaceuticalStartTime                  [s]
decayed_dose = RadionuclideTotalDose · 2^(−decay_time / RadionuclideHalfLife)  [Bq]
conc         = PixelValue · RescaleSlope + RescaleIntercept                    [Bq/mL]
SUVbw        = conc · (PatientWeight_kg · 1000) / decayed_dose
```

Korišteni DICOM tagovi: `(0018,1074)` doza, `(0018,1075)` poluživot,
`(0018,1072/1078)` vrijeme injekcije, `(0010,1030)` težina, `(0054,1001)` jedinice,
`(0008,0031/0032)` vrijeme snimanja, `(0028,1052/1053)` rescale.

## Ograničenja

- Model ekstrapolira iz **jednog vremenskog snimka** koristeći tkivne priore; nema
  pacijent-specifične kinetike (za to bi trebala dinamička PET akvizicija).
- Eksponenti su konsolidovani iz heterogenih studija (različiti tumori, skeneri,
  ulazne funkcije) — podesivi priori, ne apsolutne vrijednosti.
- Prostorna simulacija ne dodaje realni Poisson šum po vremenu; šum se modelira
  na nivou CNR metrike.

## Lokalno pokretanje

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # produkcijski build
```

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · dicom-parser · Recharts.

## Reference

- QIBA SUV: <https://qibawiki.rsna.org/index.php/Standardized_Uptake_Value_(SUV)>
- Turku PET Centre — kompartmentalni modeli: <https://www.turkupetcentre.net/petanalysis/model_compartmental.html>
- Dual-time-point / retention index: PMID 28583277, PMC4666280
- Detektabilnost i šum vs vrijeme (breast sim): PMC4721230
- Normalni organi vs vrijeme: PMC6250532
