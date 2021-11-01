import { useState } from 'react';
import cx from 'clsx';
import { useSnackbar } from 'notistack';
import secp256k1 from 'secp256k1';

import Button from '~/components/Button';
import Dialog from '~/components/Dialog';
import type { TransactionInfoData } from '~/components/Dialog/TransactionInfo';
import TransactionInfo from '~/components/Dialog/TransactionInfo';
import Input from '~/components/Input';
import Transaction from '~/components/Keystation/Transaction';
import { CHAIN } from '~/constants/chain';
import { useAxios } from '~/hooks/useAxios';
import { useChainSWR } from '~/hooks/useChainSWR';
import { useCreateTx } from '~/hooks/useCreateTx';
import { useCurrentChain } from '~/hooks/useCurrentChain';
import { useCurrentWallet } from '~/hooks/useCurrentWallet';
import { divide, getByte, gt, minus } from '~/utils/calculator';
import Ledger, { createMsgForLedger, LedgerError } from '~/utils/ledger';
import { createBroadcastBody, createSignature, createSignedTx } from '~/utils/txHelper';

import styles from './index.module.scss';

type DelegationProps = {
  open: boolean;
  onClose?: () => void;
  validatorAddress: string;
};

export default function Delegation({ open, onClose, validatorAddress }: DelegationProps) {
  const currentWallet = useCurrentWallet();
  const currentChain = useCurrentChain();
  const createTx = useCreateTx();
  const { boardcastTx } = useAxios();
  const { enqueueSnackbar } = useSnackbar();

  const [isOpenedTransaction, setIsOpenedTransaction] = useState(false);
  const [transactionInfoData, setTransactionInfoData] = useState<TransactionInfoData & { open: boolean }>({
    step: 'doing',
    title: '위임하기',
    open: false,
  });

  const [sendAmount, setSendAmount] = useState('');
  const [memo, setMemo] = useState('');

  const { data, swr } = useChainSWR();

  const { availableAmount, account } = data;

  const handleOnClick = async () => {
    try {
      await swr.account.mutate();

      if (!account) {
        throw new Error('account not found');
      }

      if (!currentWallet.HDPath) {
        throw new Error(`Path is invalid`);
      }

      if (!currentWallet.address || !validatorAddress) {
        throw new Error(`Address is invalid`);
      }

      if (gt(sendAmount, minus(availableAmount, currentChain.fee.delegate, currentChain.decimal))) {
        throw new Error(`sendAmount is invalid`);
      }

      if (
        (currentChain.path === CHAIN.IRIS && getByte(memo) > 99) ||
        (currentChain.path !== CHAIN.IRIS && getByte(memo) > 255)
      ) {
        throw new Error(`memo is invalid`);
      }

      const txMsgOrigin = createTx.getDelegateTxMsg(validatorAddress, sendAmount, memo);

      const txMsgForSign = createMsgForLedger({
        message: txMsgOrigin,
        accountNumber: account.account_number,
        chainId: currentChain.chainId,
        sequence: account.sequence,
      });

      if (currentWallet.walletType === 'ledger') {
        const ledger = await Ledger();

        const hdPath = currentWallet.HDPath.split('/').map((item) => Number(item));

        const publicKey = await ledger.getPublicKey(hdPath);

        setTransactionInfoData({
          open: true,
          step: 'doing',
          title: '위임하기',
          from: currentWallet.address,
          to: validatorAddress,
          amount: `${sendAmount} ${currentChain.symbolName}`,
          fee: `${currentChain.fee.delegate} ${currentChain.symbolName}`,
          memo,
          tx: JSON.stringify(txMsgOrigin, null, 4),
        });
        const ledgerSignature = await ledger.sign(hdPath, Buffer.from(txMsgForSign));

        const secpSignature = secp256k1.signatureImport(ledgerSignature);

        const signature = createSignature({
          publicKey,
          signature: secpSignature,
          accountNumber: account.account_number,
          sequence: account.sequence,
        });

        const tx = createSignedTx(txMsgOrigin, signature);
        const txBody = createBroadcastBody(tx);

        const result = await boardcastTx(txBody);

        setTransactionInfoData((prev) => ({ ...prev, step: 'success', open: true, txHash: result.txhash }));
      }

      if (currentWallet.walletType === 'keystation') {
        setIsOpenedTransaction(true);

        const myKeystation = new Keystation('http://localhost:3000', currentChain.lcdURL, currentWallet.HDPath);

        const popup = myKeystation.openWindow('transaction', txMsgForSign, currentWallet.keystationAccount!);

        setTransactionInfoData({
          open: true,
          step: 'doing',
          title: '위임하기',
          from: currentWallet.address,
          to: validatorAddress,
          amount: `${sendAmount} ${currentChain.symbolName}`,
          fee: `${currentChain.fee.delegate} ${currentChain.symbolName}`,
          memo,
          tx: JSON.stringify(txMsgOrigin, null, 4),
        });

        const timer = setInterval(() => {
          if (popup.closed) {
            setTransactionInfoData((prev) => {
              if (prev.step === 'success' && prev.open) {
                return prev;
              }

              return { ...prev, open: false };
            });
            setIsOpenedTransaction(false);
            clearInterval(timer);
          }
        }, 500);
      }
    } catch (e) {
      if (e instanceof LedgerError) {
        enqueueSnackbar((e as { message: string }).message, { variant: 'error' });
        setTransactionInfoData((prev) => ({ ...prev, open: false }));
      } else enqueueSnackbar((e as { message: string }).message, { variant: 'error' });
    }
  };

  const handleOnClose = () => {
    setSendAmount('');
    setMemo('');

    onClose?.();
  };
  return (
    <>
      <Dialog open={open} onClose={handleOnClose} maxWidth="lg">
        <div className={styles.container}>
          <div className={styles.title}>위임하기</div>

          <div className={styles.rowContainer}>
            <div className={styles.column1}>사용 가능 수량</div>
            <div className={cx(styles.column2, styles.textEnd)}>
              {availableAmount} {currentChain.symbolName}
            </div>
          </div>
          {/* <div className={styles.rowContainer}>
          <div className={styles.column1}>받을 지갑 주소</div>
          <div className={styles.column2}>
            <Input label="지갑 주소 입력" value={address} onChange={(event) => setAddress(event.currentTarget.value)} />
          </div>
        </div> */}
          <div className={styles.rowContainer}>
            <div className={styles.column1}>전송 수량</div>
            <div className={styles.column2}>
              <Input
                label="전송 수량 입력"
                sx={{ width: 'calc(100% - 14.8rem)', fontSize: '1.4rem' }}
                value={sendAmount}
                onChange={(event) => setSendAmount(event.currentTarget.value)}
              />
              <Button
                sx={{ fontSize: '1.4rem', width: '7rem', marginLeft: '0.4rem' }}
                onClick={() => setSendAmount(divide(availableAmount, '2', currentChain.decimal))}
              >
                1/2
              </Button>
              <Button
                sx={{ fontSize: '1.4rem', width: '7rem', marginLeft: '0.4rem' }}
                onClick={() => setSendAmount(minus(availableAmount, currentChain.fee.delegate, currentChain.decimal))}
              >
                MAX
              </Button>
            </div>
          </div>
          <div className={styles.rowContainer}>
            <div className={styles.column1}>메모 (선택 사항)</div>
            <div className={styles.column2}>
              <Input
                label="메모 내용 입력"
                multiline
                size="medium"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    minHeight: '6rem',
                  },
                }}
                value={memo}
                onChange={(event) => setMemo(event.currentTarget.value)}
              />
            </div>
          </div>
          <div className={styles.rowContainer}>
            <div className={styles.column1}>수수료</div>
            <div className={cx(styles.column2, styles.textEnd)}>
              {currentChain.fee.delegate} {currentChain.symbolName}
            </div>
          </div>
          <div className={styles.buttonContainer}>
            <Button sx={{ fontSize: '1.4rem', fontWeight: 'bold' }} colorVariant="black" onClick={handleOnClick}>
              Generate & Sign Transaction
            </Button>
          </div>
          {isOpenedTransaction && (
            <Transaction
              onSuccess={(e) => {
                setTransactionInfoData((prev) => ({ ...prev, step: 'success', open: true, txHash: e.data.txhash }));
              }}
            />
          )}
          <TransactionInfo
            open={transactionInfoData.open}
            data={transactionInfoData}
            onClose={
              transactionInfoData.step === 'success'
                ? () => {
                    setTransactionInfoData((prev) => ({ ...prev, open: false }));
                    handleOnClose();
                  }
                : undefined
            }
          />
        </div>
      </Dialog>
    </>
  );
}
