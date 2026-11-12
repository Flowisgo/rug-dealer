"""Public CLI rehearsals with a disposable fake Stellar executable; no network writes."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

class DemoPreflight(unittest.TestCase):
    def test_all_refuses_frozen_claim_store_before_any_write_and_uses_selected_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            m = json.loads((ROOT / 'docs/testnet-deployment.json').read_text())
            m['contract'] = m['usdc']  # distinct disposable identity; fake CLI only
            manifest = d / 'deployment.json'
            manifest.write_text(json.dumps(m))
            cli = d / 'stellar'
            cli.write_text('''#!/usr/bin/env python3
import sys,json,os
from pathlib import Path
m=json.loads(Path(os.environ['RUGDEALER_MANIFEST']).read_text())
a=sys.argv[1:]
with open(os.environ['CALLS'],'a') as f: f.write(json.dumps(a)+'\\n')
if 'keys' in a:
 role=a[-1].removeprefix('rd-'); print(m['accounts'][role]); sys.exit(0)
assert a[a.index('--id')+1] == m['contract'], 'wrong manifest'
assert '--send=no' in a, 'must not write before full preflight'
method=a[a.index('--')+1]
if method=='get_config': print(json.dumps(dict(m['params'],admin=m['accounts']['admin'],fee_recipient=m['accounts']['admin'],usdc=m['usdc'])))
elif method=='get_store': print(json.dumps(dict(frozen=a[-1]==m['accounts']['store2'],limit=50000000000,open_principal=0)))
else: raise Exception(method)
''')
            cli.chmod(0o755)
            calls=d/'calls'
            env=dict(os.environ,RUGDEALER_STATE=str(d/'state'),RUGDEALER_MANIFEST=str(manifest),RUGDEALER_RESULTS=str(d/'results.json'),STELLAR_CLI=str(cli),CALLS=str(calls))
            result=subprocess.run([sys.executable,str(ROOT/'scripts/testnet.py'),'demo','--scenario','all'],env=env,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('store2 is frozen',result.stderr)
            self.assertNotIn('must not write',result.stderr)
            self.assertTrue(all('--send=no' in json.loads(line) or 'keys' in json.loads(line) for line in calls.read_text().splitlines()))
            self.assertFalse((d/'results.json').exists())

if __name__ == '__main__': unittest.main()
